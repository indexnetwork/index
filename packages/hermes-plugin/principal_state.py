"""Durable private inbox and work state; no inference or network access."""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def identifier():
    return str(uuid.uuid4())


def empty_state():
    return {"revision": 0, "history": [], "incoming": [], "question": None,
            "requests": [], "outcomes": {}, "work": {}, "notes": {}, "outbox": []}


def append_message(state, entry):
    entry["createdAt"] = datetime.now(timezone.utc).isoformat()
    state["history"].append(entry)
    return entry


class PrincipalStore:
    """Serialize durable transitions within the active Hermes profile."""

    def __init__(self, home: Path):
        directory = home / "index-network"
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / "principal.sqlite3"
        with self.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS state (account TEXT, intent TEXT, value TEXT NOT NULL, PRIMARY KEY(account, intent))")
            db.execute("CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, value TEXT NOT NULL)")
        os.chmod(self.path, 0o600)

    def connect(self):
        return sqlite3.connect(self.path, timeout=30, isolation_level=None)

    @contextmanager
    def transaction(self):
        db = self.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def load(self, db, account, intent):
        row = db.execute("SELECT value FROM state WHERE account=? AND intent=?", (account, intent)).fetchone()
        return json.loads(row[0]) if row else empty_state()

    def save(self, db, account, intent, state):
        db.execute("INSERT INTO state VALUES (?, ?, ?) ON CONFLICT(account,intent) DO UPDATE SET value=excluded.value",
                   (account, intent, json.dumps(state)))

    def binding(self, db):
        row = db.execute("SELECT value FROM binding WHERE id=1").fetchone()
        return json.loads(row[0]) if row else None

    def bind(self, db, value):
        db.execute("INSERT INTO binding VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", (json.dumps(value),))

    def session(self, db, session_id):
        row = db.execute("SELECT value FROM sessions WHERE id=?", (session_id,)).fetchone()
        return json.loads(row[0]) if row else None

    def save_session(self, db, session_id, value):
        db.execute("INSERT INTO sessions VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", (session_id, json.dumps(value)))


def owner_input(state, text, input_id, question_id=None):
    """Record raw native owner input once; never expose this as an LLM tool."""
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Owner input must be nonempty text.")
    if any(entry["id"] == input_id for entry in state["history"]):
        return
    question = state["question"]
    if question_id is not None and (not question or question["id"] != question_id):
        raise ValueError("That question is no longer displayed.")
    entry = {"id": input_id, "text": text, "kind": "user", "matches": []}
    if question_id:
        entry.update(kind="answer", questionId=question_id, scope=question["scope"], matches=question["matches"])
        state["question"] = None
        state["requests"] = []
    state["incoming"].append(input_id)
    append_message(state, entry)
    state["revision"] += 1


def request_input(state, match, args):
    """Queue one focused request without publishing it to the owner."""
    question, reason, options, scope = (args.get(key) for key in ("question", "reason", "options", "scope"))
    if not isinstance(question, str) or not question.strip() or not isinstance(reason, str) or not reason.strip():
        raise ValueError("A focused question and reason are required.")
    if not isinstance(options, list) or not 2 <= len(options) <= 4 or any(not isinstance(option, str) or not option.strip() for option in options):
        raise ValueError("Supply 2–4 concise suggested answers.")
    if scope not in ("intent", "match"):
        raise ValueError("Choose intent or match scope. Approvals must use match scope.")
    if not isinstance(args.get("approval"), bool):
        raise ValueError("Specify whether this request asks for approval to commit.")
    if args["approval"] and scope != "match":
        raise ValueError("Approval to commit requires match scope.")
    if any(item["match"]["opportunityId"] == match["opportunityId"] for item in state["requests"]):
        raise ValueError("This match already has a pending request.")
    request = {"id": identifier(), "question": question, "reason": reason, "options": options,
               "scope": scope, "match": match, "reviewed": False}
    state["requests"].append(request)
    return request


def review_inbox(state, args):
    """Apply one inbox choice; only this transition creates human output."""
    action = args.get("action")
    message = args.get("message")
    has_message = isinstance(message, str) and bool(message.strip())
    requests = {request["id"]: request for request in state["requests"]}
    question = state["question"]
    related = args.get("relatedRequestIds", [])
    if action not in ("reply", "ask", "update", "wait", "reconsider"):
        raise ValueError("Choose an inbox action.")
    if state["incoming"] or action == "reply":
        if not state["incoming"] or action != "reply" or not has_message:
            raise ValueError("Reply to direct owner messages first.")
        state["incoming"] = []
        entry = {"id": identifier(), "kind": "message", "text": message, "matches": []}
        append_message(state, entry)
        return entry
    if not isinstance(related, list) or any(not isinstance(item, str) for item in related) or len(set(related)) != len(related) or any(item not in requests or item == (question or {}).get("id") for item in related):
        raise ValueError("Select distinct queued request IDs.")
    if action == "reconsider":
        if not related or not has_message:
            raise ValueError("Reconsider requires request IDs and a note citing existing evidence.")
        for request_id in related:
            request = requests[request_id]
            state["notes"][request["match"]["opportunityId"]] = message
        state["requests"] = [request for request in state["requests"] if request["id"] not in related]
        return None
    if question and action != "wait":
        raise ValueError("Keep the displayed question stable.")
    if not question and requests and action != "ask":
        raise ValueError("Resolve pending input before outcome updates.")
    selected = requests.get(args.get("requestId")) if action == "ask" else None
    if action == "ask" and not selected:
        raise ValueError("Select an existing request.")
    if related and ((selected or question or {}).get("scope") != "intent" or any(requests[item]["scope"] != "intent" for item in related)):
        raise ValueError("Only intent-wide facts can share a question; match approvals remain separate.")
    opportunity_ids = args.get("opportunityIds", [])
    if action == "update" and (not has_message or not isinstance(opportunity_ids, list) or not opportunity_ids or any(item not in state["outcomes"] for item in opportunity_ids)):
        raise ValueError("An update requires observed outcomes and a message.")
    entry = None
    if action == "ask":
        question = {key: selected[key] for key in ("id", "question", "reason", "options", "scope")}
        question["matches"] = [selected["match"]] + [requests[item]["match"] for item in related if item != selected["id"]]
        state["question"] = question
        entry = {"id": identifier(), "kind": "question", "questionId": question["id"],
                 "text": question["question"], "options": question["options"],
                 "scope": question["scope"], "reason": question["reason"], "matches": question["matches"]}
    elif action == "update":
        entry = {"id": identifier(), "kind": "message", "text": message,
                 "matches": [state["outcomes"][item]["match"] for item in opportunity_ids]}
    if entry:
        append_message(state, entry)
    for request in state["requests"]:
        request["reviewed"] = True
        if question and request["id"] in related and request["id"] != question["id"]:
            request["attachedTo"] = question["id"]
    if not question:
        state["outcomes"] = {}
    return entry
