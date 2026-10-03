"""Append-only SQLite journal of every decision, order, fill and event."""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path


class Journal:
    def __init__(self, path: str | Path):
        self._path = str(path)
        with self._conn() as c:
            c.execute(
                "CREATE TABLE IF NOT EXISTS events ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, "
                "type TEXT NOT NULL, payload TEXT NOT NULL)"
            )

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path)

    def log(self, type_: str, payload: dict, ts: datetime) -> None:
        with self._conn() as c:
            c.execute(
                "INSERT INTO events (ts, type, payload) VALUES (?, ?, ?)",
                (ts.isoformat(), type_, json.dumps(payload, default=str)),
            )

    def events(self, type_: str | None = None) -> list[dict]:
        q, args = "SELECT ts, type, payload FROM events", ()
        if type_:
            q, args = q + " WHERE type = ?", (type_,)
        with self._conn() as c:
            rows = c.execute(q + " ORDER BY id", args).fetchall()
        return [{"ts": r[0], "type": r[1], "payload": json.loads(r[2])} for r in rows]
