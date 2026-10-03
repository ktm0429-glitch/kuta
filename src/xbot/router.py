"""The only path from a trade intent to the broker. Risk gate runs on every order."""
from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum
from typing import Protocol

from .broker import Broker
from .config import RiskConfig
from .journal import Journal
from .models import Fill, OrderRequest
from .risk import RiskGate, VerdictKind

log = logging.getLogger(__name__)


class Notifier(Protocol):
    def send(self, text: str) -> None: ...


class Status(Enum):
    FILLED = "filled"
    PENDING = "pending"
    VETOED = "vetoed"
    ERROR = "error"
    EXPIRED = "expired"
    DENIED = "denied"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class SubmitResult:
    status: Status
    reason: str = ""
    fill: Fill | None = None
    pending_id: str | None = None


class OrderRouter:
    def __init__(
        self,
        broker: Broker,
        gate: RiskGate,
        journal: Journal,
        notifier: Notifier,
        cfg: RiskConfig,
        approval_timeout_s: int = 300,
    ):
        self.broker, self.gate, self.journal, self.notifier, self.cfg = broker, gate, journal, notifier, cfg
        self._timeout = timedelta(seconds=approval_timeout_s)
        self._pending: dict[str, tuple[OrderRequest, datetime]] = {}
        self._errors = 0

    # --- kill switch -----------------------------------------------------
    def trip(self, reason: str, now: datetime) -> None:
        self.gate.kill_switch.trip(reason, now)
        try:
            self.broker.flatten_all(now)
        except Exception as e:  # keep halting even if flatten fails; alert loudly
            self._notify(f"KILL SWITCH: flatten FAILED ({e!r}) - close positions manually!")
        self.journal.log("kill_switch", {"reason": reason}, now)
        self._notify(f"KILL SWITCH tripped: {reason}. Positions flattened, trading halted.")

    def tick(self, now: datetime) -> None:
        """Call every candle: trips the kill switch on daily-loss/drawdown breach."""
        if self.gate.kill_switch.is_tripped:
            return
        breach = self.gate.check_limits(self.broker.account(), now)
        if breach:
            self.trip(breach, now)

    # --- orders ----------------------------------------------------------
    def submit(self, order: OrderRequest, now: datetime) -> SubmitResult:
        verdict = self._evaluate(order, now)
        self.journal.log("verdict", {"kind": verdict.kind.value, "reason": verdict.reason, "order": order}, now)
        if verdict.trip:
            self.trip(verdict.reason, now)
        if verdict.kind is VerdictKind.VETO:
            return SubmitResult(Status.VETOED, verdict.reason)
        if verdict.kind is VerdictKind.NEEDS_APPROVAL:
            pid = uuid.uuid4().hex[:8]
            self._pending[pid] = (order, now + self._timeout)
            self._notify(f"APPROVAL NEEDED [{pid}]: {order.side.value} {order.lots} lots (expires in {self._timeout.seconds}s)")
            return SubmitResult(Status.PENDING, verdict.reason, pending_id=pid)
        return self._execute(order, now)

    def confirm(self, pending_id: str, now: datetime) -> SubmitResult:
        item = self._pending.pop(pending_id, None)
        if item is None:
            return SubmitResult(Status.UNKNOWN, "no such pending order")
        order, expires = item
        if now > expires:
            self.journal.log("approval_expired", {"id": pending_id}, now)
            return SubmitResult(Status.EXPIRED, "approval timed out")
        verdict = self._evaluate(order, now)
        if verdict.trip:
            self.trip(verdict.reason, now)
        if verdict.kind is VerdictKind.VETO:
            return SubmitResult(Status.VETOED, verdict.reason)
        return self._execute(order, now)

    def deny(self, pending_id: str, now: datetime) -> SubmitResult:
        if self._pending.pop(pending_id, None) is None:
            return SubmitResult(Status.UNKNOWN, "no such pending order")
        self.journal.log("approval_denied", {"id": pending_id}, now)
        return SubmitResult(Status.DENIED)

    # --- internals -------------------------------------------------------
    def _evaluate(self, order: OrderRequest, now: datetime):
        return self.gate.evaluate(
            order, self.broker.account(), self.broker.market(), now, len(self.broker.positions())
        )

    def _execute(self, order: OrderRequest, now: datetime) -> SubmitResult:
        try:
            fill = self.broker.send(self.gate.mint(order))
        except Exception as e:
            self._errors += 1
            self.journal.log("error", {"error": repr(e), "consecutive": self._errors}, now)
            self._notify(f"ERROR sending order ({self._errors} consecutive): {e!r}")
            if self._errors >= self.cfg.max_consecutive_errors:
                self.trip(f"{self._errors} consecutive broker errors", now)
            return SubmitResult(Status.ERROR, repr(e))
        self._errors = 0
        self.journal.log("fill", {"fill": fill, "reason": order.reason}, now)
        self._notify(f"Fill: {fill.side.value} {fill.lots} lots @ {fill.price}")
        return SubmitResult(Status.FILLED, fill=fill)

    def _notify(self, text: str) -> None:
        try:
            self.notifier.send(text)
        except Exception:
            log.exception("notifier failed")
