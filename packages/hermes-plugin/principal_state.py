"""Which Index account this machine negotiates for, and in which conversation.

This is the whole of the plugin's durable state. Negotiation state — the private
inbox, questions, matches, and turn history — belongs to `@indexnetwork/agent`
running in the negotiator sidecar, which checkpoints it itself.

The row is shared across processes: the dashboard writes it when the owner
selects a negotiator, and the gateway's event reader consults it to decide
whether to run the negotiator at all.
"""

from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class PrincipalStore:
    """Serialize the negotiator binding within the active Hermes profile."""

    def __init__(self, home: Path):
        directory = home / "index-network"
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = directory / "principal.sqlite3"
        with self.transaction() as db:
            db.execute("CREATE TABLE IF NOT EXISTS binding (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL)")
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

    def binding(self, db):
        """@returns The account, agent, owner conversation and focused signal, or None."""
        row = db.execute("SELECT value FROM binding WHERE id=1").fetchone()
        return json.loads(row[0]) if row else None

    def bind(self, db, value):
        db.execute("INSERT INTO binding VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value", (json.dumps(value),))

    def unbind(self, db):
        db.execute("DELETE FROM binding WHERE id=1")
