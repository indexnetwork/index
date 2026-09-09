"""Hermes scheduling, authoritative gateway input, and private inbox delivery."""

from __future__ import annotations

import contextvars
import json
import re
import threading
from pathlib import Path

from .negotiation import NegotiationTools, selected_agent
from .principal_state import PrincipalStore, owner_input


SKILL_PATH = Path(__file__).parent / "skills" / "personal-agent" / "SKILL.md"
SWEEP_PROMPT = "Run one bounded Index personal-agent sweep. Load index-network:personal-agent, call index_list_negotiations, process each returned match once, then review each returned intent's inbox. Never wait inside this run for a human. Only index_review_principal_inbox selects human delivery. Finish with [SILENT]; the plugin renders selected inbox entries."
_REPLY = re.compile(r"^Index ([0-9a-f-]{36})(?:/([0-9a-f-]{36}))?:\s*(.+)$", re.I | re.S)


def source_key(platform, chat, sender, thread):
    return json.dumps([platform, chat, sender, thread or ""])


class NativeAgent:
    """Capture owner input outside model tools and leave inference to Hermes."""

    def __init__(self, ctx):
        from hermes_constants import get_hermes_home
        self.ctx = ctx
        self.store = PrincipalStore(get_hermes_home())
        self.operations = NegotiationTools(self.store)
        self.inbound = {}
        self.turns = {}

    def pre_gateway_dispatch(self, *, event, **kwargs):
        source = event.source
        if event.internal or source.is_bot or source.chat_type != "dm" or not source.user_id or not event.message_id or not isinstance(event.text, str):
            return None
        key = source_key(source.platform.value, source.chat_id, source.user_id, source.thread_id)
        native = {"text": event.text, "messageId": event.message_id, "source": key}
        self.inbound[key] = native
        with self.store.transaction() as db:
            binding = self.store.binding(db)
            if not binding or binding["source"] != key:
                return None
            if event.text.strip().lower() == "index off":
                binding.pop("intentId", None)
                binding.pop("questionId", None)
                self.store.bind(db, binding)
                return None
            prefix = _REPLY.match(event.text)
            intent_id = prefix[1] if prefix else binding.get("intentId")
            if not intent_id:
                return None
            # Only previously observed owned intents may receive raw input. A new
            # focus is validated through REST by index_focus_intent first.
            if not db.execute("SELECT 1 FROM state WHERE account=? AND intent=?", (binding["account"], intent_id)).fetchone():
                native["error"] = "Focus that Index intent before sending private input."
                return None
            state = self.store.load(db, binding["account"], intent_id)
            question_id = prefix[2] if prefix else binding.get("questionId")
            try:
                owner_input(state, prefix[3] if prefix else event.text,
                            f"{key}:{event.message_id}", question_id)
            except ValueError as exc:
                native["error"] = str(exc)
                return None
            native["intentId"] = intent_id
            binding.update(intentId=intent_id, questionId=None, wake=True)
            self.store.save(db, binding["account"], intent_id, state)
            self.store.bind(db, binding)
        return None

    def pre_llm_call(self, *, session_id="", turn_id="", platform="", parent_session_id="", **kwargs):
        self.turns.pop(session_id, None)
        if not session_id or parent_session_id:
            return None
        with self.store.transaction() as db:
            binding = self.store.binding(db)
            if binding and platform == "cron" and session_id.startswith(f'cron_{binding["jobId"]}_'):
                current = self.store.session(db, session_id)
                if not current:
                    self.store.save_session(db, session_id, {"mode": "sweep", "account": binding["account"],
                                            "agentId": binding["agentId"], "turnId": turn_id})
                return {"context": SKILL_PATH.read_text()}
        # The context variables come from the native gateway dispatch, not tool args.
        from gateway.session_context import get_session_env
        key = source_key(platform, get_session_env("HERMES_SESSION_CHAT_ID", ""),
                         get_session_env("HERMES_SESSION_USER_ID", ""),
                         get_session_env("HERMES_SESSION_THREAD_ID", ""))
        native = self.inbound.pop(key, None)
        if not native or native["messageId"] != get_session_env("HERMES_SESSION_MESSAGE_ID", ""):
            return None  # internal events and CLI prompts cannot become owner answers
        self.turns[session_id] = native
        if native.get("error"):
            return {"context": "Index did not record this input: " + native["error"] + " Do not treat it as authority for any match."}
        if not binding or binding["source"] != key:
            return None
        intent_id = native.get("intentId")
        if not intent_id:
            return None
        with self.store.transaction() as db:
            self.store.save_session(db, session_id, {"mode": "owner", "account": binding["account"],
                                    "agentId": binding["agentId"], "intentId": intent_id, "delivery": []})
        return {"context": SKILL_PATH.read_text() + "\n\nThis is the owner inbox. Actual native input has already been recorded. Read and review the inbox for intent " + intent_id + ". Deliver only the selected reply or exact displayed question. Match work runs separately. If the owner wants to leave this conversation, tell them to send Index off."}

    def configure_personal_agent(self, args, session_id):
        native = self.turns.get(session_id)
        if not native:
            raise ValueError("Enable the personal agent from the owner's private Hermes gateway conversation.")
        agent = selected_agent()
        if agent["id"] != args.get("agentId") or agent["type"] != "external" or agent["status"] != "active" or not agent["handleNegotiations"]:
            raise ValueError("Select the Hermes external agent in Index first, then provide its exact agent ID.")
        # The native registry is also consulted after a restart during setup, so
        # repeating setup cannot create a second job after a lost local response.
        name = f'Index personal agent {agent["ownerId"]}/{agent["id"]}'
        jobs = json.loads(self.ctx.dispatch_tool("cronjob_manage", {"action": "list"}, session_id=session_id))
        if not jobs.get("success"):
            raise ValueError(jobs.get("error") or "Could not inspect Hermes schedules.")
        existing = next((job for job in jobs["jobs"] if job["name"] == name), None)
        with self.store.transaction() as db:
            binding = self.store.binding(db)
            if binding and (binding["account"] != agent["ownerId"] or binding["source"] != native["source"]):
                raise ValueError("This profile already has an Index owner conversation. Use that conversation or a separate Hermes profile.")
        if binding and binding["agentId"] != agent["id"]:
            paused = json.loads(self.ctx.dispatch_tool("cronjob_manage", {"action": "pause", "job_id": binding["jobId"]}, session_id=session_id))
            if not paused.get("success"):
                raise ValueError("Could not pause the previous Index executor's schedule.")
        if not existing:
            result = json.loads(self.ctx.dispatch_tool("cronjob_manage", {
                "action": "create", "name": name, "schedule": "every 2m", "prompt": SWEEP_PROMPT,
                "skills": ["index-network:personal-agent"], "enabled_toolsets": ["index-network"],
                "deliver": "origin",
            }, session_id=session_id))
            if not result.get("success"):
                raise ValueError(result.get("error") or "Hermes could not create the native schedule.")
            existing = result["job"]
        with self.store.transaction() as db:
            self.store.bind(db, {**(binding or {}), "account": agent["ownerId"], "agentId": agent["id"],
                                 "jobId": existing["job_id"], "source": native["source"]})
            self.store.save_session(db, session_id, {"mode": "owner", "account": agent["ownerId"],
                                    "agentId": agent["id"], "delivery": []})
        return {"configured": True, "jobId": existing["job_id"], "delivery": existing.get("deliver"),
                "instruction": "Use index_focus_intent to choose the private conversation. Keep the Hermes gateway running. Send Index off to leave intent focus. All active intents are covered by rotating sweeps."}

    def focus_intent(self, args, session_id):
        native = self.turns.get(session_id)
        with self.store.transaction() as db:
            binding = self.operations.selected(db)
            if not native or native["source"] != binding["source"]:
                raise ValueError("Only the configured gateway owner may focus an intent.")
            intent_id = args.get("intentId")
            context = self.operations.context(binding["account"], intent_id)
            state = self.store.load(db, binding["account"], intent_id)
            self.operations.sync_context(state, context)
            # The initiating message is real owner text too (e.g. a status question).
            if not native.get("intentId"):
                owner_input(state, native["text"], f'{native["source"]}:{native["messageId"]}')
                native["intentId"] = intent_id
            self.store.save(db, binding["account"], intent_id, state)
            binding.update(intentId=intent_id, questionId=None, wake=True)
            self.store.bind(db, binding)
            self.store.save_session(db, session_id, {"mode": "owner", "account": binding["account"],
                                    "agentId": binding["agentId"], "intentId": intent_id, "delivery": []})
        return {"intentId": intent_id, "instructions": SKILL_PATH.read_text(),
                "instruction": "Read and review this intent's inbox. Subsequent owner messages in this private conversation belong to this intent until Index off. Never supply human answers through a tool."}

    def pre_tool_call(self, *, tool_name="", session_id="", **kwargs):
        with self.store.transaction() as db:
            session = self.store.session(db, session_id)
        if session and session["mode"] == "sweep" and tool_name not in {
            "skill_view", "index_list_negotiations", "index_read_negotiation", "index_submit_turn",
            "index_request_principal_input", "index_read_principal_inbox", "index_review_principal_inbox",
        }:
            return {"action": "block", "message": "Index background work uses only scoped negotiation and inbox tools."}
        return None

    def transform_llm_output(self, *, session_id="", platform="", **kwargs):
        if platform != "cron":
            return None
        with self.store.transaction() as db:
            session = self.store.session(db, session_id)
            if not session or session["mode"] != "sweep":
                return None
            if "delivery" not in session:
                entries = []
                for intent in session.get("batch", {}).get("intents", []):
                    state = self.store.load(db, session["account"], intent["id"])
                    # Skip questions canceled or answered before delivery. Selection
                    # survives a crash before rendering; rendered output belongs to
                    # Hermes's durable cron delivery and is never blindly resent.
                    entries.extend(entry for entry in state["outbox"] if entry["kind"] != "question" or entry["questionId"] == (state["question"] or {}).get("id"))
                    state["outbox"] = []
                    self.store.save(db, session["account"], intent["id"], state)
                session["delivery"] = entries
                self.store.save_session(db, session_id, session)
            return render_delivery(session["delivery"]) or "[SILENT]"

    def post_llm_call(self, *, session_id="", platform="", **kwargs):
        native = self.turns.pop(session_id, None)
        if not native or platform == "cron":
            return
        with self.store.transaction() as db:
            binding = self.store.binding(db)
            if not binding or binding["source"] != native["source"] or not binding.get("wake"):
                return
            binding["wake"] = False
            self.store.bind(db, binding)
        # Scheduling only: the native cron tool owns the execution and model loop.
        # Dispatch off the hook thread because Hermes may run inline when no async
        # parent is available. A failed wake leaves the recurring sweep in place.
        context = contextvars.copy_context()
        def wake():
            self.ctx.dispatch_tool("cronjob_manage", {"action": "run", "job_id": binding["jobId"]}, session_id=session_id)
        threading.Thread(target=context.run, args=(wake,), daemon=True).start()

    def handler(self, name):
        def handle(args, **kwargs):
            try:
                if not isinstance(args, dict):
                    raise ValueError("Arguments must be an object.")
                return json.dumps(getattr(self, name)(args, kwargs.get("session_id", "")))
            except Exception as exc:
                return json.dumps({"success": False, "error": str(exc)})
        return handle


def render_delivery(entries):
    from .tools import _app_base_url
    rendered = []
    for entry in entries:
        text = f'Index {entry["intentId"]}:\n{entry["text"]}'
        if entry["kind"] == "question":
            matches = ", ".join(f'[{item["counterparty"].get("name") or item["counterparty"].get("userId", "Match")}]({_app_base_url()}/o/{item["opportunityId"]})' for item in entry["matches"])
            text += f'\n{entry["reason"]}\nScope: {entry["scope"]}. For: {matches}'
            text += "\n" + "\n".join(f"{i}. {option}" for i, option in enumerate(entry["options"], 1))
            text += f'\nReply: Index {entry["intentId"]}/{entry["questionId"]}: <your answer>'
        rendered.append(text)
    return "\n\n".join(rendered)
