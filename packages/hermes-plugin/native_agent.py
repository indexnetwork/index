"""Authoritative owner input, captured outside the model and handed to the negotiator.

Hermes does not reason about a message that is Index personal-agent input: the
gateway hook records it and reports it consumed, so the negotiator running in the
sidecar is the only thing that reads it. That keeps the question and answer flow
inside `@indexnetwork/agent`, identical to the hosted Index runtime.
"""

from __future__ import annotations

import json
import logging
import re

from .tools import selected_agent

logger = logging.getLogger(__name__)

# The gateway platform that carries Index events. Declared here rather than in
# `events`, which reaches into the gateway packages this module must not.
PLATFORM = "index"
_REPLY = re.compile(r"^Index ([0-9a-f-]{36})(?:/([0-9a-f-]{36}))?:\s*(.+)$", re.I | re.S)
# Hermes must not answer text the negotiator already accepted as owner input.
_CONSUMED = {"action": "skip", "reason": "Recorded as Index personal-agent input."}


def source_key(platform, chat, sender, thread):
    return json.dumps([platform, chat, sender, thread or ""])


class NativeAgent:
    """Bind one Hermes conversation to an Index account and route its input."""

    def __init__(self, ctx, sidecar):
        self.ctx = ctx
        self.sidecar = sidecar
        self.store = sidecar.store
        self.inbound = {}
        self.turns = {}

    def pre_gateway_dispatch(self, *, event, **kwargs):
        """Record the owner's message, and consume it when it belongs to a signal.

        @param event - The inbound gateway message.
        @returns A skip decision when the negotiator accepted it, otherwise None
                 so Hermes handles the message as an ordinary conversation.
        """
        source = event.source
        if event.internal or source.is_bot or source.chat_type != "dm" or not source.user_id or not event.message_id or not isinstance(event.text, str):
            return None
        key = source_key(source.platform.value, source.chat_id, source.user_id, source.thread_id)
        self.inbound[key] = {"text": event.text, "messageId": event.message_id, "source": key}
        with self.store.transaction() as db:
            binding = self.store.binding(db)
            if not binding or binding.get("source") != key:
                return None
            if event.text.strip().lower() == "index off":
                binding.pop("intentId", None)
                self.store.bind(db, binding)
                return None
            prefix = _REPLY.match(event.text)
            intent_id = prefix[1] if prefix else binding.get("intentId")
            if not intent_id:
                return None
            if prefix:
                # An addressed reply also moves the focus, so an unprefixed
                # follow-up continues the signal the owner just answered about.
                binding["intentId"] = intent_id
                self.store.bind(db, binding)
        return self._record(intent_id, prefix[2] if prefix else None, prefix[3] if prefix else event.text)

    def _record(self, intent_id, question_id, text):
        """Hand one owner message to the negotiator as an answer or a message.

        An unreachable or refusing negotiator falls through to Hermes rather than
        swallowing the message, so the owner always gets a response.
        """
        try:
            if question_id is None:
                pending = self.sidecar.call("/pending", {"intentId": intent_id}).get("pending")
                question_id = (pending or {}).get("id")
            route = "/answer" if question_id else "/message"
            payload = {"intentId": intent_id, "text": text}
            if question_id:
                payload["questionId"] = question_id
            accepted = self.sidecar.call(route, payload).get("accepted")
        except Exception as error:  # noqa: BLE001
            logger.warning("Index negotiator did not record owner input: %s", error)
            return None
        return _CONSUMED if accepted else None

    def pre_llm_call(self, *, session_id="", platform="", parent_session_id="", **kwargs):
        """Bind this model turn to the owner message that started it.

        Setup tools verify the conversation through this mapping, so a tool
        argument cannot claim to speak for the owner's private conversation.
        """
        self.turns.pop(session_id, None)
        if not session_id or parent_session_id:
            return None
        # The context variables come from the native gateway dispatch, not tool args.
        from gateway.session_context import get_session_env

        key = source_key(platform, get_session_env("HERMES_SESSION_CHAT_ID", ""),
                         get_session_env("HERMES_SESSION_USER_ID", ""),
                         get_session_env("HERMES_SESSION_THREAD_ID", ""))
        native = self.inbound.pop(key, None)
        if native and native["messageId"] == get_session_env("HERMES_SESSION_MESSAGE_ID", ""):
            self.turns[session_id] = native
        return None

    def configure_personal_agent(self, args, session_id):
        """Bind this conversation as the owner's Index channel and start the negotiator."""
        native = self.turns.get(session_id)
        if not native:
            raise ValueError("Enable the personal agent from the owner's private Hermes gateway conversation.")
        agent = selected_agent()
        if agent["id"] != args.get("agentId") or agent["type"] != "external" or agent["status"] != "active" or not agent["handleNegotiations"]:
            raise ValueError("Select the Hermes external agent in Index first, then provide its exact agent ID.")
        # The binding is a single row, so repeating setup after a lost local
        # response rebinds the same executor instead of adding a second one. A
        # machine selected from the dashboard carries no conversation yet, so
        # this is also how that binding gains one.
        with self.store.transaction() as db:
            binding = self.store.binding(db)
            if binding and (binding["account"] != agent["ownerId"] or binding.get("source") not in (None, native["source"])):
                raise ValueError("This profile already has an Index owner conversation. Use that conversation or a separate Hermes profile.")
            self.store.bind(db, {**(binding or {}), "account": agent["ownerId"], "agentId": agent["id"],
                                 "source": native["source"]})
        self.sidecar.start(agent["ownerId"], agent["id"])
        return {"configured": True,
                "instruction": "Use index_focus_intent to choose the signal this conversation is about. Keep the Hermes gateway running. Send Index off to leave that focus. Index events wake each active signal as its matches move, and the personal agent asks its own questions here."}

    def focus_intent(self, args, session_id):
        """Point this conversation's unaddressed messages at one signal."""
        native = self.turns.get(session_id)
        with self.store.transaction() as db:
            binding = self.store.binding(db)
        if not binding:
            raise ValueError("Configure the Index personal agent first.")
        if not native or native["source"] != binding.get("source"):
            raise ValueError("Only the configured gateway owner may focus an intent.")
        intent_id = args.get("intentId")
        if not isinstance(intent_id, str) or not intent_id:
            raise ValueError("An intent ID is required.")
        # The negotiator validates ownership and activity when it opens the
        # signal, so the focus is only recorded once that succeeded. The
        # initiating message is real owner text too, not just a selection.
        self.sidecar.call("/message", {"intentId": intent_id, "text": native["text"]})
        with self.store.transaction() as db:
            binding = self.store.binding(db)
            binding["intentId"] = intent_id
            self.store.bind(db, binding)
        return {"intentId": intent_id,
                "instruction": "Subsequent owner messages in this private conversation belong to this signal until Index off. The personal agent replies here itself; never answer for it or invent its questions."}

    def handler(self, name):
        def handle(args, **kwargs):
            try:
                if not isinstance(args, dict):
                    raise ValueError("Arguments must be an object.")
                return json.dumps(getattr(self, name)(args, kwargs.get("session_id", "")))
            except Exception as exc:
                return json.dumps({"success": False, "error": str(exc)})
        return handle
