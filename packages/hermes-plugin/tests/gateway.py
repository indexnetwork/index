"""Direct loaded-gateway tests for hidden Hermes pass identity and attempt fencing."""

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


def main() -> None:
    plugin = load_plugin()
    tools = plugin.tools
    original_urlopen = urllib.request.urlopen
    calls = []
    call_lock = threading.Lock()
    pending = {
        "session-a": ("neg-a", "cap-a"),
        "session-b": ("neg-b", "cap-b"),
        "session-c": ("neg-c", "cap-c"),
        "session-d": ("neg-d", "cap-d"),
        "session-e": ("neg-e", "cap-e"),
        "session-f": ("neg-f", "cap-f"),
    }
    transport_failures = {"neg-f": 1}

    def fake_urlopen(request, timeout):
        del timeout
        headers = {key.lower(): value for key, value in request.header_items()}
        with call_lock:
            calls.append((request.full_url, headers, request.data))
        if request.full_url.endswith("/pickup"):
            run_id = headers["x-index-hermes-run-id"]
            match = next(
                ((negotiation, capability) for session, (negotiation, capability) in pending.items()
                 if state_run_id(tools, session) == run_id),
                None,
            )
            if not match:
                raise AssertionError("pickup used an unknown hidden run id")
            negotiation, capability = match
            return Response({"negotiationId": negotiation, "runCapability": capability})
        if "/neg-b/consult" in request.full_url or "/neg-c/respond" in request.full_url:
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
        assert decode(tools.index_pickup_negotiation({"agentId": "agent"}))["success"] is False
        assert decode(tools.index_pickup_negotiation(
            {"agentId": "agent", "task_id": "model-session"}, task_id="session-a"
        )) == {"success": False, "error": "Unexpected arguments: task_id."}
        assert calls == []

        # Two cron sessions share one loaded plugin process but receive distinct
        # hidden run IDs/capabilities. A repeated pickup in one session is local.
        first = decode(tools.index_pickup_negotiation({"agentId": "agent"}, task_id="session-a"))
        second = decode(tools.index_pickup_negotiation({"agentId": "agent"}, task_id="session-b"))
        assert first["negotiationId"] == "neg-a" and second["negotiationId"] == "neg-b"
        assert state_run_id(tools, "session-a") != state_run_id(tools, "session-b")
        before = len(calls)
        assert decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="session-a"
        )) == {"success": False, "error": "This Hermes run has already attempted negotiation pickup."}
        assert len(calls) == before

        # Once a failed consult dispatch returns, respond and changed consult
        # bodies are denied without another mutation call. Exact repetition is
        # served from the cached result and likewise cannot retry over network.
        failed_consult = {
            "agentId": "agent", "negotiationId": "neg-b",
            "reason": "consequential_disclosure_permission",
        }
        result = decode(tools.index_consult_owner(failed_consult, task_id="session-b"))
        assert result["success"] is False and result["status"] == 503
        mutation_count = mutation_calls(calls)
        assert decode(tools.index_respond_negotiation({
            "agentId": "agent", "negotiationId": "neg-b",
            "action": "continue", "roleAlignment": "peers",
        }, task_id="session-b"))["success"] is False
        assert decode(tools.index_consult_owner({
            **failed_consult, "reason": "unresolved_owner_constraint",
        }, task_id="session-b"))["success"] is False
        assert decode(tools.index_consult_owner(failed_consult, task_id="session-b")) == result
        assert mutation_calls(calls) == mutation_count

        # The inverse failed respond -> consult fence is identical.
        decode(tools.index_pickup_negotiation({"agentId": "agent"}, task_id="session-c"))
        failed_response = {
            "agentId": "agent", "negotiationId": "neg-c",
            "action": "continue", "roleAlignment": "peers",
        }
        assert decode(tools.index_respond_negotiation(failed_response, task_id="session-c"))["status"] == 503
        mutation_count = mutation_calls(calls)
        assert decode(tools.index_consult_owner({
            "agentId": "agent", "negotiationId": "neg-c",
            "reason": "consequential_disclosure_permission",
        }, task_id="session-c"))["success"] is False
        assert mutation_calls(calls) == mutation_count

        # A changed response body after a successful dispatch is also denied.
        decode(tools.index_pickup_negotiation({"agentId": "agent"}, task_id="session-d"))
        response = {
            "agentId": "agent", "negotiationId": "neg-d",
            "action": "continue", "roleAlignment": "peers",
        }
        assert decode(tools.index_respond_negotiation(response, task_id="session-d"))["success"] is True
        mutation_count = mutation_calls(calls)
        assert decode(tools.index_respond_negotiation({
            **response, "action": "decline",
        }, task_id="session-d"))["success"] is False
        assert mutation_calls(calls) == mutation_count

        # Concurrent mutation dispatch has one winner and exactly one HTTP call.
        decode(tools.index_pickup_negotiation({"agentId": "agent"}, task_id="session-e"))
        barrier = threading.Barrier(3)
        results = []

        def submit(action):
            barrier.wait()
            results.append(decode(tools.index_respond_negotiation({
                "agentId": "agent", "negotiationId": "neg-e",
                "action": action, "roleAlignment": "peers",
            }, task_id="session-e")))

        threads = [threading.Thread(target=submit, args=(action,)) for action in ("continue", "decline")]
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
        decode(tools.index_pickup_negotiation({"agentId": "agent"}, task_id="session-f"))
        exact = {
            "agentId": "agent", "negotiationId": "neg-f",
            "action": "continue", "roleAlignment": "peers",
        }
        assert decode(tools.index_respond_negotiation(exact, task_id="session-f"))["success"] is True
        transport_calls = [entry for entry in calls if "/neg-f/respond" in entry[0]]
        assert len(transport_calls) == 2
        assert transport_calls[0][1:] == transport_calls[1][1:]
        assert decode(tools.index_respond_negotiation(exact, task_id="session-f"))["success"] is True
        assert len([entry for entry in calls if "/neg-f/respond" in entry[0]]) == 2

        # Forced capacity must preserve every kind of live authority/tombstone,
        # reject a sixth task locally, and permit reuse only after TTL expiry.
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
            self.pickups = {
                "connector-pickup": ("neg-pickup", "cap-pickup"),
                "connector-consult": ("neg-consult", "cap-consult"),
                "connector-denied": ("neg-denied", "cap-denied"),
                "known-400-timeout": ("neg-400", "cap-400"),
                "known-500-network": ("neg-500", "cap-500"),
                "successful-timeout": ("neg-timeout", "cap-timeout"),
            }

        def request_rest(self, method, path, body=None, *, hermes_run=None):
            call = (method, path, json.dumps(body, sort_keys=True), dict(hermes_run or {}))
            self.calls.append(call)
            queued = self.failures.get(path, [])
            if queued:
                code = queued.pop(0)
                raise tools.TransportError(code, "injected ambiguous response")
            if path.endswith("/pickup"):
                task_id = next(
                    task for task, state in tools._NEGOTIATION_RUN_STATES.items()
                    if state.run_id == hermes_run["runId"]
                )
                if task_id == "known-400-timeout":
                    return {"success": False, "status": 400, "error": "definitive 400"}
                if task_id == "known-500-network":
                    return {"success": False, "status": 500, "error": "definitive 500"}
                negotiation, capability = self.pickups[task_id]
                return {"negotiationId": negotiation, "runCapability": capability}
            return {"success": True, "status": "recorded"}

    tools._reset_negotiation_run_for_tests()
    fake = FakeReplayTransport()
    tools.set_transport_for_tests(fake)
    try:
        pickup_path = "/agents/agent/negotiations/pickup"
        known400 = decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="known-400-timeout"
        ))
        assert known400["status"] == 400 and known400["success"] is False
        assert len([
            call for call in fake.calls
            if call[1] == pickup_path and call[3]["runId"]
                == tools._NEGOTIATION_RUN_STATES["known-400-timeout"].run_id
        ]) == 1
        known500 = decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="known-500-network"
        ))
        assert known500["status"] == 500 and known500["success"] is False
        assert len([
            call for call in fake.calls
            if call[1] == pickup_path and call[3]["runId"]
                == tools._NEGOTIATION_RUN_STATES["known-500-network"].run_id
        ]) == 1

        timedPickup = decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="successful-timeout"
        ))
        assert timedPickup["negotiationId"] == "neg-timeout"
        timeout_path = "/agents/agent/negotiations/neg-timeout/respond"
        fake.failures[timeout_path] = ["timeout"]
        timeout_args = {
            "agentId": "agent", "negotiationId": "neg-timeout",
            "action": "continue", "roleAlignment": "peers",
        }
        timedOut = decode(tools.index_respond_negotiation(
            timeout_args, task_id="successful-timeout"
        ))
        assert timedOut["success"] is True
        timeout_calls = [call for call in fake.calls if call[1] == timeout_path]
        assert len(timeout_calls) == 2 and timeout_calls[0] == timeout_calls[1]

        fake.failures[pickup_path] = ["network_error"]
        picked = decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="connector-pickup"
        ))
        assert picked["negotiationId"] == "neg-pickup"
        pickup_calls = [
            call for call in fake.calls
            if call[1] == pickup_path and call[3]["runId"]
                == tools._NEGOTIATION_RUN_STATES["connector-pickup"].run_id
        ]
        assert len(pickup_calls) == 2 and pickup_calls[0] == pickup_calls[1]

        respond_path = "/agents/agent/negotiations/neg-pickup/respond"
        fake.failures[respond_path] = ["network_error"]
        response_args = {
            "agentId": "agent", "negotiationId": "neg-pickup",
            "action": "continue", "roleAlignment": "peers",
        }
        response = decode(tools.index_respond_negotiation(
            response_args, task_id="connector-pickup"
        ))
        assert response["success"] is True
        respond_calls = [call for call in fake.calls if call[1] == respond_path]
        assert len(respond_calls) == 2 and respond_calls[0] == respond_calls[1]
        assert decode(tools.index_respond_negotiation(
            response_args, task_id="connector-pickup"
        )) == response
        assert len([call for call in fake.calls if call[1] == respond_path]) == 2

        decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="connector-consult"
        ))
        consult_path = "/agents/agent/negotiations/neg-consult/consult"
        fake.failures[consult_path] = ["network_error"]
        consult_args = {
            "agentId": "agent", "negotiationId": "neg-consult",
            "reason": "repeated_non_convergence",
        }
        consultation = decode(tools.index_consult_owner(
            consult_args, task_id="connector-consult"
        ))
        assert consultation["success"] is True
        consult_calls = [call for call in fake.calls if call[1] == consult_path]
        assert len(consult_calls) == 2 and consult_calls[0] == consult_calls[1]
        assert decode(tools.index_consult_owner(
            consult_args, task_id="connector-consult"
        )) == consultation
        assert len([call for call in fake.calls if call[1] == consult_path]) == 2

        decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="connector-denied"
        ))
        denied_path = "/agents/agent/negotiations/neg-denied/respond"
        fake.failures[denied_path] = ["route_denied"]
        denied_args = {
            "agentId": "agent", "negotiationId": "neg-denied",
            "action": "decline", "roleAlignment": "peers",
        }
        denied = decode(tools.index_respond_negotiation(
            denied_args, task_id="connector-denied"
        ))
        assert denied["success"] is False and denied["code"] == "route_denied"
        assert len([call for call in fake.calls if call[1] == denied_path]) == 1
        assert decode(tools.index_respond_negotiation(
            denied_args, task_id="connector-denied"
        )) == denied
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
    tools._NEGOTIATION_RUN_MAX_STATES = 5
    tools._NEGOTIATION_RUN_STATE_TTL_SECONDS = 10
    tools.time.monotonic = lambda: clock[0]

    calls = []
    call_lock = threading.Lock()
    pickup_entered = threading.Event()
    release_pickup = threading.Event()
    mutation_entered = threading.Event()
    release_mutation = threading.Event()
    pickup_counts = {}

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
        if request.full_url.endswith("/pickup"):
            pickup_counts[task_id] = pickup_counts.get(task_id, 0) + 1
            if task_id == "capacity-pickup-inflight":
                pickup_entered.set()
                assert release_pickup.wait(2)
            if task_id == "capacity-exhausted":
                return Response(None, status=204)
            suffix = pickup_counts[task_id]
            return Response({
                "negotiationId": f"neg-{task_id}-{suffix}",
                "runCapability": f"cap-{task_id}-{suffix}",
            })
        if task_id == "capacity-mutation-inflight":
            mutation_entered.set()
            assert release_mutation.wait(2)
        return Response({"success": True, "status": "recorded"})

    original_urlopen = urllib.request.urlopen
    urllib.request.urlopen = fake_capacity_urlopen
    try:
        pickup_results = []
        pickup_thread = threading.Thread(target=lambda: pickup_results.append(decode(
            tools.index_pickup_negotiation(
                {"agentId": "agent"}, task_id="capacity-pickup-inflight"
            )
        )))
        pickup_thread.start()
        assert pickup_entered.wait(2)

        bound = decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="capacity-capability-bound"
        ))
        assert bound["pending"] is True

        inflight_pickup = decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="capacity-mutation-inflight"
        ))
        inflight_args = {
            "agentId": "agent",
            "negotiationId": inflight_pickup["negotiationId"],
            "action": "continue",
            "roleAlignment": "peers",
        }
        mutation_results = []
        mutation_thread = threading.Thread(target=lambda: mutation_results.append(decode(
            tools.index_respond_negotiation(
                inflight_args, task_id="capacity-mutation-inflight"
            )
        )))
        mutation_thread.start()
        assert mutation_entered.wait(2)

        exhausted = decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="capacity-exhausted"
        ))
        assert exhausted == {"success": True, "pending": False}

        cached_pickup = decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="capacity-cached-result"
        ))
        cached_args = {
            "agentId": "agent",
            "negotiationId": cached_pickup["negotiationId"],
            "action": "accept",
            "roleAlignment": "peers",
        }
        cached_result = decode(tools.index_respond_negotiation(
            cached_args, task_id="capacity-cached-result"
        ))
        assert cached_result["success"] is True
        assert len(tools._NEGOTIATION_RUN_STATES) == 5
        original_run_ids = {
            task_id: state.run_id
            for task_id, state in tools._NEGOTIATION_RUN_STATES.items()
        }

        # Capacity rejection is wholly local, even when all five distinct live
        # authority forms occupy the store.
        before = len(calls)
        rejected = decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="capacity-sixth"
        ))
        assert rejected == {
            "success": False,
            "error": "Hermes negotiation pass state capacity is temporarily exhausted.",
        }
        assert len(calls) == before
        assert "capacity-sixth" not in tools._NEGOTIATION_RUN_STATES

        # Reusing every authoritative task_id before expiry stays on the same
        # run and cannot repeat pickup or mutation over the network.
        assert decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="capacity-pickup-inflight"
        ))["success"] is False
        assert decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="capacity-capability-bound"
        ))["success"] is False
        assert decode(tools.index_respond_negotiation(
            inflight_args, task_id="capacity-mutation-inflight"
        ))["success"] is False
        assert decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="capacity-exhausted"
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
        assert decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="capacity-sixth"
        ))["success"] is False
        assert len(calls) == before

        # Even after TTL, an operation that is still physically in flight is
        # not safe to replace. It keeps the same run until dispatch returns.
        clock[0] = 1_010.001
        pickup_state, pickup_error = tools._negotiation_run_state({
            "task_id": "capacity-pickup-inflight"
        })
        mutation_state, mutation_error = tools._negotiation_run_state({
            "task_id": "capacity-mutation-inflight"
        })
        assert pickup_error is None and mutation_error is None
        assert pickup_state.run_id == original_run_ids["capacity-pickup-inflight"]
        assert mutation_state.run_id == original_run_ids["capacity-mutation-inflight"]
        assert len(calls) == before

        release_pickup.set()
        release_mutation.set()
        pickup_thread.join(2)
        mutation_thread.join(2)
        assert not pickup_thread.is_alive() and not mutation_thread.is_alive()
        assert pickup_results[0]["success"] is True
        assert mutation_results[0]["success"] is True

        # A strictly post-TTL observation prunes the completed cached receipt
        # and lets the same task_id mint a fresh run/pickup.
        reused = decode(tools.index_pickup_negotiation(
            {"agentId": "agent"}, task_id="capacity-cached-result"
        ))
        assert reused["success"] is True and reused["pending"] is True
        assert state_run_id(tools, "capacity-cached-result") != original_run_ids["capacity-cached-result"]
        assert len(calls) == before + 1
    finally:
        release_pickup.set()
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
    return len([url for url, _headers, _body in calls if url.endswith("/respond") or url.endswith("/consult")])


if __name__ == "__main__":
    main()
