"""Direct loaded-gateway tests for hidden Hermes pass identity and mutation fencing.

Negotiation-graph rewrite (#1494): there is no more pickup/claim/consult --
`index_respond_negotiation` is the only negotiation mutation left, and every
run-state invariant this file checks (hidden task_id required, per-session
run isolation, one mutation per pass, ambiguous-replay retry, capacity) now
centers on that single tool.
"""

from __future__ import annotations

import importlib.util
import io
import json
import pathlib
import sys
import threading
import time
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_plugin():
    name = "index_network_gateway_test_plugin"
    spec = importlib.util.spec_from_file_location(
        name,
        ROOT / "__init__.py",
        submodule_search_locations=[str(ROOT)],
    )
    if spec is None or spec.loader is None:
        raise AssertionError("Could not load plugin")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class Response:
    headers = {"Content-Type": "application/json"}

    def __init__(self, payload, status=200):
        self.payload = payload
        self.status = status
        self.code = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        if self.status == 204:
            return b""
        return json.dumps(self.payload).encode()


def failure(request, status=503):
    body = json.dumps({"error": "temporary failure"}).encode()
    return urllib.error.HTTPError(
        request.full_url,
        status,
        "HTTP error",
        {"Content-Type": "application/json"},
        io.BytesIO(body),
    )


def decode(value):
    return json.loads(value)


def response_args(negotiation_id, action="counter"):
    return {"agentId": "agent", "negotiationId": negotiation_id, "action": action}


def main() -> None:
    plugin = load_plugin()
    tools = plugin.tools
    original_urlopen = urllib.request.urlopen
    calls = []
    call_lock = threading.Lock()
    transport_failures = {"neg-f": 1}

    def fake_urlopen(request, timeout):
        del timeout
        headers = {key.lower(): value for key, value in request.header_items()}
        with call_lock:
            calls.append((request.full_url, headers, request.data))
        if "/neg-c/respond" in request.full_url:
            raise failure(request)
        if "/neg-f/respond" in request.full_url and transport_failures["neg-f"] > 0:
            transport_failures["neg-f"] -= 1
            raise urllib.error.URLError("connection reset")
        if "/neg-e/" in request.full_url:
            time.sleep(0.05)
        return Response({"success": True, "status": "recorded"})

    try:
        import os
        os.environ["INDEX_API_KEY"] = "gateway-test-key"
        os.environ["INDEX_API_URL"] = "https://api.example.test/api"
        urllib.request.urlopen = fake_urlopen

        # Production handlers fail closed without Hermes' hidden task_id and do
        # not accept a model-authored substitute in the tool argument object.
        assert decode(tools.index_respond_negotiation(response_args("neg-a")))["success"] is False
        assert decode(tools.index_respond_negotiation(
            {**response_args("neg-a"), "task_id": "model-session"}, task_id="session-a"
        )) == {"success": False, "error": "Unexpected arguments: task_id."}
        assert calls == []

        # Two cron sessions share one loaded plugin process but receive distinct
        # hidden run IDs.
        assert decode(tools.index_respond_negotiation(response_args("neg-a"), task_id="session-a"))["success"] is True
        assert decode(tools.index_respond_negotiation(response_args("neg-b"), task_id="session-b"))["success"] is True
        assert state_run_id(tools, "session-a") != state_run_id(tools, "session-b")

        # A failed mutation dispatch is denied a repeat with a changed body but
        # served the cached failure on exact repetition -- no second HTTP call.
        failing = response_args("neg-c")
        result = decode(tools.index_respond_negotiation(failing, task_id="session-c"))
        assert result["success"] is False and result["status"] == 503
        mutation_count = mutation_calls(calls)
        assert decode(tools.index_respond_negotiation(
            {**failing, "action": "question"}, task_id="session-c"
        )) == {
            "success": False,
            "error": "This Hermes run has already used its one negotiation mutation.",
        }
        assert decode(tools.index_respond_negotiation(failing, task_id="session-c")) == result
        assert mutation_calls(calls) == mutation_count

        # A changed response body after a successful dispatch is also denied.
        response = response_args("neg-d")
        assert decode(tools.index_respond_negotiation(response, task_id="session-d"))["success"] is True
        mutation_count = mutation_calls(calls)
        assert decode(tools.index_respond_negotiation(
            {**response, "action": "recommend_reject"}, task_id="session-d"
        ))["success"] is False
        assert mutation_calls(calls) == mutation_count

        # Concurrent mutation dispatch has one winner and exactly one HTTP call.
        barrier = threading.Barrier(3)
        results = []

        def submit(action):
            barrier.wait()
            results.append(decode(tools.index_respond_negotiation(
                response_args("neg-e", action), task_id="session-e"
            )))

        threads = [threading.Thread(target=submit, args=(action,)) for action in ("counter", "question")]
        for thread in threads:
            thread.start()
        barrier.wait()
        for thread in threads:
            thread.join()
        assert sum(result["success"] is True for result in results) == 1
        assert sum("in progress" in result.get("error", "") or "already used" in result.get("error", "") for result in results) == 1
        assert len([url for url, _headers, _body in calls if "/neg-e/respond" in url]) == 1

        # Ambiguous transport recovery is the sole network retry: it happens
        # internally with the exact same operation/body/hidden authority, and a
        # later model repetition is served locally.
        exact = response_args("neg-f")
        assert decode(tools.index_respond_negotiation(exact, task_id="session-f"))["success"] is True
        transport_calls = [entry for entry in calls if "/neg-f/respond" in entry[0]]
        assert len(transport_calls) == 2
        assert transport_calls[0][1:] == transport_calls[1][1:]
        assert decode(tools.index_respond_negotiation(exact, task_id="session-f"))["success"] is True
        assert len([entry for entry in calls if "/neg-f/respond" in entry[0]]) == 2

        # Forced capacity must preserve every live authority/tombstone, reject
        # a task locally past capacity, and permit reuse only after TTL expiry.
        run_forced_capacity_test(tools)
        run_ambiguous_replay_test(tools)
    finally:
        urllib.request.urlopen = original_urlopen

    print("Hermes plugin direct gateway tests passed")


def run_ambiguous_replay_test(tools):
    class FakeReplayTransport:
        def __init__(self):
            self.calls = []
            self.failures = {}

        def request_rest(self, method, path, body=None, *, hermes_run=None):
            call = (method, path, json.dumps(body, sort_keys=True), dict(hermes_run or {}))
            self.calls.append(call)
            queued = self.failures.get(path, [])
            if queued:
                code = queued.pop(0)
                raise tools.TransportError(code, "injected ambiguous response")
            return {"success": True, "status": "recorded"}

    tools._reset_negotiation_run_for_tests()
    fake = FakeReplayTransport()
    tools.set_transport_for_tests(fake)
    try:
        timeout_path = "/agents/agent/negotiations/neg-timeout/respond"
        fake.failures[timeout_path] = ["timeout"]
        timedOut = decode(tools.index_respond_negotiation(
            response_args("neg-timeout"), task_id="successful-timeout"
        ))
        assert timedOut["success"] is True
        timeout_calls = [call for call in fake.calls if call[1] == timeout_path]
        assert len(timeout_calls) == 2 and timeout_calls[0] == timeout_calls[1]

        respond_path = "/agents/agent/negotiations/neg-connector/respond"
        fake.failures[respond_path] = ["network_error"]
        connector_args = response_args("neg-connector")
        response = decode(tools.index_respond_negotiation(connector_args, task_id="connector"))
        assert response["success"] is True
        respond_calls = [call for call in fake.calls if call[1] == respond_path]
        assert len(respond_calls) == 2 and respond_calls[0] == respond_calls[1]
        assert decode(tools.index_respond_negotiation(connector_args, task_id="connector")) == response
        assert len([call for call in fake.calls if call[1] == respond_path]) == 2

        denied_path = "/agents/agent/negotiations/neg-denied/respond"
        fake.failures[denied_path] = ["route_denied"]
        denied_args = response_args("neg-denied", "recommend_reject")
        denied = decode(tools.index_respond_negotiation(denied_args, task_id="denied"))
        assert denied["success"] is False and denied["code"] == "route_denied"
        assert len([call for call in fake.calls if call[1] == denied_path]) == 1
        assert decode(tools.index_respond_negotiation(denied_args, task_id="denied")) == denied
        assert len([call for call in fake.calls if call[1] == denied_path]) == 1
    finally:
        tools.set_transport_for_tests(None)
        tools._reset_negotiation_run_for_tests()


def run_forced_capacity_test(tools):
    tools._reset_negotiation_run_for_tests()
    original_max = tools._NEGOTIATION_RUN_MAX_STATES
    original_ttl = tools._NEGOTIATION_RUN_STATE_TTL_SECONDS
    original_monotonic = tools.time.monotonic
    clock = [1_000.0]
    tools._NEGOTIATION_RUN_MAX_STATES = 3
    tools._NEGOTIATION_RUN_STATE_TTL_SECONDS = 10
    tools.time.monotonic = lambda: clock[0]

    calls = []
    call_lock = threading.Lock()
    mutation_entered = threading.Event()
    release_mutation = threading.Event()

    def task_for_run_id(run_id):
        with tools._NEGOTIATION_RUN_LOCK:
            return next(
                (task_id for task_id, state in tools._NEGOTIATION_RUN_STATES.items()
                 if state.run_id == run_id),
                None,
            )

    def fake_capacity_urlopen(request, timeout):
        del timeout
        headers = {key.lower(): value for key, value in request.header_items()}
        run_id = headers["x-index-hermes-run-id"]
        task_id = task_for_run_id(run_id)
        if task_id is None:
            raise AssertionError("capacity request used an unknown hidden run id")
        with call_lock:
            calls.append((task_id, request.full_url, run_id, request.data))
        if task_id == "capacity-mutation-inflight":
            mutation_entered.set()
            assert release_mutation.wait(2)
        return Response({"success": True, "status": "recorded"})

    original_urlopen = urllib.request.urlopen
    urllib.request.urlopen = fake_capacity_urlopen
    try:
        inflight_args = response_args("neg-inflight")
        mutation_results = []
        mutation_thread = threading.Thread(target=lambda: mutation_results.append(decode(
            tools.index_respond_negotiation(inflight_args, task_id="capacity-mutation-inflight")
        )))
        mutation_thread.start()
        assert mutation_entered.wait(2)

        cached_args = response_args("neg-cached")
        cached_result = decode(tools.index_respond_negotiation(cached_args, task_id="capacity-cached-result"))
        assert cached_result["success"] is True

        third_args = response_args("neg-third")
        decode(tools.index_respond_negotiation(third_args, task_id="capacity-third"))
        assert len(tools._NEGOTIATION_RUN_STATES) == 3
        original_run_ids = {
            task_id: state.run_id
            for task_id, state in tools._NEGOTIATION_RUN_STATES.items()
        }

        # Capacity rejection is wholly local, even when all three live
        # authority forms occupy the store.
        before = len(calls)
        rejected = decode(tools.index_respond_negotiation(response_args("neg-fourth"), task_id="capacity-fourth"))
        assert rejected == {
            "success": False,
            "error": "Hermes negotiation pass state capacity is temporarily exhausted.",
        }
        assert len(calls) == before
        assert "capacity-fourth" not in tools._NEGOTIATION_RUN_STATES

        # Reusing every authoritative task_id before expiry stays on the same
        # run and cannot repeat mutation over the network.
        assert decode(tools.index_respond_negotiation(
            inflight_args, task_id="capacity-mutation-inflight"
        ))["success"] is False
        assert decode(tools.index_respond_negotiation(
            cached_args, task_id="capacity-cached-result"
        )) == cached_result
        assert len(calls) == before
        assert {
            task_id: state.run_id
            for task_id, state in tools._NEGOTIATION_RUN_STATES.items()
        } == original_run_ids

        # A backward clock observation cannot expire live state.
        clock[0] = 999.0
        assert decode(tools.index_respond_negotiation(
            response_args("neg-fourth"), task_id="capacity-fourth"
        ))["success"] is False
        assert len(calls) == before

        # Even after TTL, an operation that is still physically in flight is
        # not safe to replace. It keeps the same run until dispatch returns.
        clock[0] = 1_010.001
        mutation_state, mutation_error = tools._negotiation_run_state({
            "task_id": "capacity-mutation-inflight"
        })
        assert mutation_error is None
        assert mutation_state.run_id == original_run_ids["capacity-mutation-inflight"]
        assert len(calls) == before

        release_mutation.set()
        mutation_thread.join(2)
        assert not mutation_thread.is_alive()
        assert mutation_results[0]["success"] is True

        # A strictly post-TTL observation prunes the completed cached receipt
        # and lets the same task_id mint a fresh run.
        reused = decode(tools.index_respond_negotiation(
            response_args("neg-cached-2"), task_id="capacity-cached-result"
        ))
        assert reused["success"] is True
        assert state_run_id(tools, "capacity-cached-result") != original_run_ids["capacity-cached-result"]
        assert len(calls) == before + 1
    finally:
        release_mutation.set()
        urllib.request.urlopen = original_urlopen
        tools.time.monotonic = original_monotonic
        tools._NEGOTIATION_RUN_MAX_STATES = original_max
        tools._NEGOTIATION_RUN_STATE_TTL_SECONDS = original_ttl
        tools._reset_negotiation_run_for_tests()


def state_run_id(tools, task_id):
    state = tools._NEGOTIATION_RUN_STATES.get(task_id)
    return state.run_id if state else None


def mutation_calls(calls):
    return len([url for url, _headers, _body in calls if url.endswith("/respond")])


if __name__ == "__main__":
    main()
