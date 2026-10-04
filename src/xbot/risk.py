"""Hard risk limits. Deterministic; no model output can override a veto.

The only way to obtain an ApprovedOrder (the only thing a Broker accepts) is
RiskGate.mint, which the OrderRouter calls after a non-VETO verdict.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path

from .config import RiskConfig
from .models import AccountState, MarketState, OrderRequest, Side

_GATE_TOKEN = object()


class VerdictKind(Enum):
    ALLOW = "allow"
    NEEDS_APPROVAL = "needs_approval"
    VETO = "veto"


@dataclass(frozen=True)
class Verdict:
    kind: VerdictKind
    reason: str = ""
    trip: bool = False


@dataclass(frozen=True)
class ApprovedOrder:
    order: OrderRequest
    _token: object = field(repr=False, compare=False)

    def __post_init__(self):
        if self._token is not _GATE_TOKEN:
            raise PermissionError("ApprovedOrder can only be created by RiskGate")


class _JsonFile:
    def __init__(self, path: str | Path):
        self.path = Path(path)

    def read(self) -> dict | None:
        if not self.path.exists():
            return None
        return json.loads(self.path.read_text())

    def write(self, data: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp.write_text(json.dumps(data))
        tmp.replace(self.path)


class KillSwitch:
    """Persisted on disk so a restart cannot silently resume trading."""

    def __init__(self, path: str | Path):
        self._file = _JsonFile(path)

    @property
    def is_tripped(self) -> bool:
        return self._file.path.exists()

    def reason(self) -> str | None:
        d = self._file.read()
        return d["reason"] if d else None

    def trip(self, reason: str, ts: datetime) -> None:
        if not self.is_tripped:
            self._file.write({"reason": reason, "ts": ts.isoformat()})

    def reset(self) -> None:
        self._file.path.unlink(missing_ok=True)


class EquityTracker:
    """Tracks day-start and peak equity, persisted across restarts (cached in memory)."""

    def __init__(self, path: str | Path):
        self._file = _JsonFile(path)
        self._s: dict | None = self._file.read()

    @property
    def peak_equity(self) -> float | None:
        return self._s["peak"] if self._s else None

    @property
    def day_start_equity(self) -> float | None:
        return self._s["day_start"] if self._s else None

    def update(self, equity: float, now: datetime) -> None:
        day = now.date().isoformat()
        s = dict(self._s) if self._s else None
        if s is None:
            s = {"day": day, "day_start": equity, "peak": equity}
        else:
            if s["day"] != day:
                s["day"], s["day_start"] = day, equity
            s["peak"] = max(s["peak"], equity)
        if s != self._s:
            self._s = s
            self._file.write(s)


class RiskGate:
    def __init__(self, cfg: RiskConfig, kill_switch: KillSwitch, tracker: EquityTracker):
        self.cfg = cfg
        self.kill_switch = kill_switch
        self.tracker = tracker

    @staticmethod
    def mint(order: OrderRequest) -> ApprovedOrder:
        return ApprovedOrder(order=order, _token=_GATE_TOKEN)

    def check_limits(self, account: AccountState, now: datetime) -> str | None:
        """Return a breach description if daily-loss or drawdown limit is hit."""
        self.tracker.update(account.equity, now)
        day_start, peak = self.tracker.day_start_equity, self.tracker.peak_equity
        if day_start:
            loss = (day_start - account.equity) / day_start * 100
            if loss >= self.cfg.daily_loss_limit_pct:
                return f"daily loss {loss:.2f}% >= {self.cfg.daily_loss_limit_pct}%"
        if peak:
            dd = (peak - account.equity) / peak * 100
            if dd >= self.cfg.max_drawdown_pct:
                return f"drawdown {dd:.2f}% >= {self.cfg.max_drawdown_pct}%"
        return None

    def evaluate(
        self,
        order: OrderRequest,
        account: AccountState,
        market: MarketState,
        now: datetime,
        open_positions: int,
    ) -> Verdict:
        c = self.cfg
        breach = self.check_limits(account, now)
        if self.kill_switch.is_tripped:
            return Verdict(VerdictKind.VETO, f"kill switch tripped: {self.kill_switch.reason()}")
        if breach:
            return Verdict(VerdictKind.VETO, breach, trip=True)
        if order.lots <= 0:
            return Verdict(VerdictKind.VETO, "lots must be positive")
        if order.lots > c.max_position_lots:
            return Verdict(VerdictKind.VETO, f"lots {order.lots} > max {c.max_position_lots}")
        if order.sl is None:
            return Verdict(VerdictKind.VETO, "stop loss required")
        ref = market.ask if order.side is Side.BUY else market.bid
        long_ = order.side is Side.BUY
        if (order.sl >= ref) if long_ else (order.sl <= ref):
            return Verdict(VerdictKind.VETO, "stop loss on wrong side of market")
        if order.tp is not None and ((order.tp <= ref) if long_ else (order.tp >= ref)):
            return Verdict(VerdictKind.VETO, "take profit on wrong side of market")
        if open_positions >= c.max_open_positions:
            return Verdict(VerdictKind.VETO, "max open positions reached")
        age = (now - market.last_candle_ts).total_seconds()
        if age > c.stale_data_candles * c.timeframe_seconds:
            return Verdict(VerdictKind.VETO, f"stale data ({age:.0f}s old)")
        if market.spread_points > c.max_spread_points:
            return Verdict(VerdictKind.VETO, f"spread {market.spread_points:.0f} pts too wide")
        if order.lots > c.approval_threshold_lots:
            return Verdict(VerdictKind.NEEDS_APPROVAL, "above manual-approval threshold")
        return Verdict(VerdictKind.ALLOW)
