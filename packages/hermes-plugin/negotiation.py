"""Native Hermes operations. Decisions belong to Hermes, effects to Index."""

from __future__ import annotations

import json
from urllib.parse import quote

from .principal_state import identifier, request_input, review_inbox
from .transport import get_transport


def api(method, path, body=None):
    result = get_transport().request_rest(method, path, body)
    if result.get("success") is False or result.get("error"):
        raise ValueError(result.get("error") or "Index request failed")
    return result


def path_id(value):
    if not isinstance(value, str) or not value:
        raise ValueError("An ID is required.")
    return quote(value, safe="")


def selected_agent():
    identity = api("GET", "/agents/me")
    if identity.get("negotiationExecutorFence") is not True:
        raise ValueError("This Index API does not support fenced external turns. Upgrade the API before enabling the Hermes personal agent.")
    return identity["agent"]


def rotate(items, cursor, limit):
    if not items:
        return [], 0
    start = cursor % len(items)
    ordered = items[start:] + items[:start]
    return ordered[:limit], (start + min(limit, len(items))) % len(items)


class NegotiationTools:
    """Bind native work to an account, intent, context revision, and session."""

    def __init__(self, store):
        self.store = store

    def selected(self, db):
        binding = self.store.binding(db)
        if not binding:
            raise ValueError("Configure the Index personal agent first.")
        agent = selected_agent()
        if agent["id"] != binding["agentId"] or agent["ownerId"] != binding["account"] or agent["type"] != "external" or agent["status"] != "active" or not agent["handleNegotiations"]:
            raise ValueError("Hermes is no longer the selected executor. Stop this work.")
        return binding

    def session(self, db, session_id, *, background=False):
        session = self.store.session(db, session_id)
        binding = self.store.binding(db)
        if not session or not binding or session.get("account") != binding["account"] or session.get("agentId") != binding["agentId"] or (background and session.get("mode") != "sweep"):
            raise ValueError("Match work is available only in the configured native background sweep.")
        return session

    def context(self, account, intent_id):
        intent = api("GET", f"/intents/{path_id(intent_id)}")["intent"]
        if intent.get("userId") != account or intent.get("archivedAt") or (intent.get("status") or "ACTIVE") != "ACTIVE":
            raise ValueError("This intent is inactive or belongs to another owner.")
        user = api("GET", "/auth/me")["user"]
        if user["id"] != account:
            raise ValueError("The authenticated Index account changed.")
        profile = {key: user.get(key) for key in ("name", "intro", "location")} if (user.get("onboarding") or {}).get("profileConfirmedAt") else None
        messages = api("GET", f'/conversations/agent/messages?intentId={path_id(intent_id)}')["messages"]
        history = []
        for message in messages:
            stored = (message.get("metadata") or {}).get("principalMessage") or {}
            kind = stored.get("kind", "user" if message.get("role") == "user" else "message")
            if kind in ("user", "answer") and message.get("senderId") != account:
                continue
            history.append({**stored, "id": message["id"], "createdAt": message["createdAt"],
                            "kind": kind, "matches": stored.get("matches", []),
                            "text": "\n".join(part["text"] for part in message["parts"] if part.get("kind") == "text" and isinstance(part.get("text"), str))})
        return {"principal": {"id": account, "name": user.get("name")},
                "intent": {key: intent.get(key) for key in ("id", "payload", "status", "archivedAt")},
                "confirmedProfile": profile, "principalConversation": history}

    def sync_context(self, state, context):
        if state.get("context") != context:
            state["context"] = context
            state["revision"] += 1

    def observe(self, state, record):
        match = {"opportunityId": record["opportunityId"], "counterparty": record["counterparty"]}
        stopped = record.get("settledAt") or record["protocol"].get("blockedReason") not in (None, "not_your_turn")
        if stopped:
            signature = json.dumps(record, sort_keys=True)
            reported = state.setdefault("reported", {})
            if reported.get(record["opportunityId"]) != signature:
                state["outcomes"][record["opportunityId"]] = {"match": match, "result": record}
                reported[record["opportunityId"]] = signature
            removed = [item for item in state["requests"] if item["match"]["opportunityId"] == record["opportunityId"]]
            if any(item["id"] == (state["question"] or {}).get("id") for item in removed):
                state["question"] = None
                for item in state["requests"]:
                    item.pop("attachedTo", None)
                    item["reviewed"] = False
            state["requests"] = [item for item in state["requests"] if item not in removed]
        return match

    def list_negotiations(self, args, session_id):
        with self.store.transaction() as db:
            binding = self.selected(db)
            session = self.session(db, session_id)
            negotiations = api("GET", "/negotiations")["negotiations"]
            intents = []
            page = 1
            while True:
                result = api("POST", "/intents/list", {"page": page, "limit": 100, "archived": False})
                intents.extend(item for item in result["intents"] if item.get("status") == "ACTIVE")
                if page >= result["pagination"]["total"]:
                    break
                page += 1
            if session["mode"] == "owner":
                return {"account": binding["account"], "intents": intents, "negotiations": negotiations}
            if "batch" not in session:
                intents.sort(key=lambda item: item["id"])
                priority = next((item for item in intents if item["id"] == binding.get("wakeIntent")), None)
                total = len(intents)
                intents, binding["cursor"] = rotate(intents, binding.get("cursor", 0), 4)
                if priority and priority not in intents:
                    intents[-1] = priority
                    binding["cursor"] = (binding["cursor"] - 1) % total
                binding.pop("wakeIntent", None)
                matches = []
                for intent in intents:
                    state = self.store.load(db, binding["account"], intent["id"])
                    pending = {item["match"]["opportunityId"] for item in state["requests"]}
                    candidates = sorted((item for item in negotiations if item["intentId"] == intent["id"] and not item["settledAt"] and item["awaitingUserId"] == binding["account"] and item["opportunityId"] not in pending), key=lambda item: item["opportunityId"])
                    selected, state["cursor"] = rotate(candidates, state.get("cursor", 0), 4)
                    matches.extend(selected)
                    self.store.save(db, binding["account"], intent["id"], state)
                session["batch"] = {"intents": intents, "negotiations": matches}
                self.store.bind(db, binding)
                self.store.save_session(db, session_id, session)
            return {"account": binding["account"], **session["batch"],
                    "instruction": "This rotating batch is the work limit for this native run. Process each returned match once, then review each intent inbox. Other intents and matches run in subsequent sweeps."}

    def read_negotiation(self, args, session_id):
        with self.store.transaction() as db:
            binding = self.selected(db)
            session = self.session(db, session_id, background=True)
            if args.get("opportunityId") not in {item["opportunityId"] for item in session.get("batch", {}).get("negotiations", [])}:
                raise ValueError("Choose a match from index_list_negotiations for this bounded sweep.")
            record = api("GET", f'/negotiations/{path_id(args.get("opportunityId"))}')["negotiation"]
            intent_id = record["intentId"]
            context = self.context(binding["account"], intent_id)
            state = self.store.load(db, binding["account"], intent_id)
            self.sync_context(state, context)
            self.observe(state, record)
            agreements = self.agreements()
            previous = state["work"].get(record["opportunityId"])
            # A fresh read reconciles an uncertain POST, but never grants a second
            # attempt against the same observed turn in the same native run.
            attempted = record["opportunityId"] in session.get("finished", [])
            waiting = any(item["match"]["opportunityId"] == record["opportunityId"] for item in state["requests"])
            work = None
            if not attempted and not waiting and not record.get("settledAt") and not record["protocol"].get("blockedReason") and record["protocol"]["availableActions"]:
                work = {"id": identifier(), "session": session_id, "revision": state["revision"],
                        "turnCount": record["turnCount"], "record": record, "context": context,
                        "agreements": agreements, "status": "ready"}
                state["work"][record["opportunityId"]] = work
                session["decision"] = work["id"]
                session.pop("review", None)
                self.store.save_session(db, session_id, session)
            self.store.save(db, binding["account"], intent_id, state)
            return {"negotiation": record, **context, "principalConversation": context["principalConversation"] + state["history"],
                    "acceptedCommitments": agreements, "communicationReview": state["notes"].get(record["opportunityId"]),
                    "workId": work["id"] if work else None, "intentId": intent_id,
                    "previousAttempt": previous, "waitingForPrincipal": waiting}

    def work(self, db, args, session_id):
        binding = self.selected(db)
        session = self.session(db, session_id, background=True)
        intent_id = args.get("intentId")
        context = self.context(binding["account"], intent_id)
        state = self.store.load(db, binding["account"], intent_id)
        work = state["work"].get(args.get("opportunityId"))
        if not work or args.get("opportunityId") in session.get("finished", []) or session.get("decision") != work["id"] or work["id"] != args.get("workId") or work["session"] != session_id or work["status"] != "ready":
            raise ValueError("No unused work ID for this match in this native run. Re-read Index and reconsider.")
        if state["revision"] != work["revision"] or context != work["context"]:
            raise ValueError("Principal context changed. Re-read Index and reconsider; do not reuse this decision.")
        return binding, intent_id, state, work

    def submit_turn(self, args, session_id):
        # Commit the attempt BEFORE the network effect. A process crash or a lost
        # response must leave evidence that this decision was already attempted.
        with self.store.transaction() as db:
            binding, intent_id, state, work = self.work(db, args, session_id)
            record = work["record"]
            action, message = args.get("action"), args.get("message")
            protocol = record["protocol"]
            if action not in protocol["availableActions"] or protocol["blockedReason"] or record["turnCount"] >= protocol["maxTurns"]:
                raise ValueError("The observed protocol does not permit this action.")
            if not isinstance(message, str) or not message.strip() or len(message.encode("utf-16-le")) // 2 > protocol["messageLimit"]:
                raise ValueError("A nonempty message within protocol.messageLimit is required.")
            agreements = self.agreements()
            if agreements != work["agreements"]:
                raise ValueError("Agreements changed. Read current context and reconsider conflicting offers.")
            work["status"] = "attempted"
            work["turn"] = {"action": action, "message": message.strip(), "expectedTurnCount": work["turnCount"]}
            session = self.session(db, session_id, background=True)
            session.setdefault("finished", []).append(args["opportunityId"])
            self.store.save_session(db, session_id, session)
            self.store.save(db, binding["account"], intent_id, state)
        # Serialize through completion, and recheck after acquiring the lock so
        # owner input received between the transactions invalidates the decision.
        with self.store.transaction() as db:
            self.selected(db)
            state = self.store.load(db, binding["account"], intent_id)
            current = state["work"].get(args["opportunityId"])
            if not current or current["id"] != work["id"] or current["status"] != "attempted":
                raise ValueError("Another native session replaced this work. Do not submit this decision.")
            if state["revision"] != work["revision"] or self.context(binding["account"], intent_id) != work["context"]:
                raise ValueError("Principal context changed before submission. Reconsider on the next sweep.")
            try:
                result = api("POST", f'/negotiations/{path_id(args["opportunityId"])}/turns?executorId={path_id(binding["agentId"])}',
                             work["turn"])
                state["work"][args["opportunityId"]]["status"] = "submitted"
                self.observe(state, result["negotiation"])
            except Exception as exc:
                state["work"][args["opportunityId"]].update(status="uncertain", error=str(exc))
                result = {"success": False, "error": str(exc), "submissionStatus": "rejected_or_uncertain"}
                try:
                    result["negotiation"] = api("GET", f'/negotiations/{path_id(args["opportunityId"])}')["negotiation"]
                    self.observe(state, result["negotiation"])
                except Exception as read_error:
                    result["reconciliationError"] = str(read_error)
                result["instruction"] = "Do not retry. This attempt is consumed; reconsider from authoritative state on a later sweep."
                state["outcomes"][args["opportunityId"]] = {"match": {"opportunityId": args["opportunityId"], "counterparty": record["counterparty"]}, "result": {"error": str(exc), "submissionStatus": "rejected_or_uncertain"}}
            self.store.save(db, binding["account"], intent_id, state)
            return result

    def agreements(self):
        """Read actual agreed terms; list summaries do not contain commitments."""
        summaries = api("GET", "/negotiations?state=settled")["negotiations"]
        return [api("GET", f'/negotiations/{path_id(item["opportunityId"])}')["negotiation"]
                for item in sorted(summaries, key=lambda item: item["opportunityId"]) if item["outcome"] == "agreed"]

    def request_principal_input(self, args, session_id):
        with self.store.transaction() as db:
            binding, intent_id, state, work = self.work(db, args, session_id)
            match = self.observe(state, work["record"])
            request = request_input(state, match, args)
            work["status"] = "waiting"
            session = self.session(db, session_id, background=True)
            session.setdefault("finished", []).append(args["opportunityId"])
            self.store.save_session(db, session_id, session)
            self.store.save(db, binding["account"], intent_id, state)
            return {"request": request, "instruction": "Internal request queued. Continue other matches, then review the inbox."}

    def read_principal_inbox(self, args, session_id):
        with self.store.transaction() as db:
            binding = self.selected(db)
            session = self.session(db, session_id)
            intent_id = args.get("intentId")
            if session["mode"] == "sweep" and intent_id not in {item["id"] for item in session.get("batch", {}).get("intents", [])}:
                raise ValueError("Review an intent in this bounded sweep.")
            if session["mode"] == "owner" and intent_id != session.get("intentId"):
                raise ValueError("Focus this intent before reviewing its private inbox.")
            context = self.context(binding["account"], intent_id)
            state = self.store.load(db, binding["account"], intent_id)
            self.sync_context(state, context)
            negotiations = api("GET", f'/negotiations?intentId={path_id(intent_id)}')["negotiations"]
            # Reconcile restored requests against authoritative detailed records.
            records = []
            for item in negotiations:
                record = api("GET", f'/negotiations/{path_id(item["opportunityId"])}')["negotiation"]
                self.observe(state, record)
                records.append(record)
            review_id = identifier()
            session["review"] = {"id": review_id, "intentId": intent_id, "revision": state["revision"], "context": context}
            session.pop("decision", None)
            if session["mode"] == "owner":
                session["questionId"] = (state["question"] or {}).get("id")
                binding["questionId"] = session["questionId"]
                self.store.bind(db, binding)
            self.store.save_session(db, session_id, session)
            self.store.save(db, binding["account"], intent_id, state)
            return {"reviewId": review_id, **context, "principalConversation": context["principalConversation"] + state["history"],
                    "incomingMessages": [entry for entry in state["history"] if entry["id"] in state["incoming"]],
                    "pendingQuestion": state["question"], "requests": state["requests"],
                    "outcomes": list(state["outcomes"].values()), "negotiations": records,
                    "submissionAttempts": {key: {field: work[field] for field in ("status", "turnCount", "error") if field in work} for key, work in state["work"].items()},
                    "acceptedCommitments": self.agreements()}

    def review_principal_inbox(self, args, session_id):
        with self.store.transaction() as db:
            binding = self.selected(db)
            session = self.session(db, session_id)
            review = session.get("review")
            if not review or review["id"] != args.get("reviewId"):
                raise ValueError("Read the inbox before reviewing it.")
            intent_id = review["intentId"]
            state = self.store.load(db, binding["account"], intent_id)
            if state["revision"] != review["revision"] or self.context(binding["account"], intent_id) != review["context"]:
                raise ValueError("Principal context changed. Read the inbox and reconsider.")
            entry = review_inbox(state, args)
            session.pop("review")
            if entry:
                if session["mode"] == "sweep":
                    state["outbox"].append({"intentId": intent_id, **entry})
                else:
                    session.setdefault("delivery", []).append({"intentId": intent_id, **entry})
                    session["questionId"] = (state["question"] or {}).get("id")
                    binding["questionId"] = session["questionId"]
                    self.store.bind(db, binding)
            self.store.save_session(db, session_id, session)
            self.store.save(db, binding["account"], intent_id, state)
            return {"delivery": entry, "instruction": "Only this selected entry may be delivered to the principal."}

    def handler(self, name):
        def handle(args, **kwargs):
            try:
                if not isinstance(args, dict):
                    raise ValueError("Arguments must be an object.")
                result = getattr(self, name)(args, kwargs.get("session_id", ""))
                return json.dumps(result)
            except Exception as exc:
                return json.dumps({"success": False, "error": str(exc)})
        return handle
