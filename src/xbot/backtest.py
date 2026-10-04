"""Event-driven backtest using the SAME risk gate, router and broker code as paper trading.

Timing per bar j (no lookahead):
  open(j):  gap exits -> submit the order decided at close(j-1) -> intrabar exits (stop wins ties)
  close(j): mark to market, router.tick (kill switch) -> snapshot of closed candles <= j -> strategy decides
Costs: spread comes from the data (bid-based bars, ask = bid + spread), slippage is configurable and
works against us on entries and stop exits. Swap is not modeled; there is no commission on Standard accounts.
"""
from __future__ import annotations

import re
import tempfile
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Callable

from .broker import SimBroker
from .config import RiskConfig
from .journal import Journal
from .models import AccountState, Candle, MarketState, OrderRequest, Position, Side
from .risk import EquityTracker, KillSwitch, RiskGate
from .router import OrderRouter, Status
from .state import Snapshot, StateEngine


@dataclass(frozen=True)
class CostModel:
    slippage_points: float = 2.0


@dataclass(frozen=True)
class Context:
    ts: datetime
    positions: list[Position]
    account: AccountState


Strategy = Callable[[Snapshot, Context], "OrderRequest | None"]


@dataclass(frozen=True)
class Trade:
    entry_ts: datetime
    exit_ts: datetime
    side: Side
    lots: float
    entry: float
    exit: float
    pnl: float
    exit_reason: str
    equity_before: float
    snapshot: Snapshot | None


@dataclass(frozen=True)
class EquityPoint:
    ts: datetime
    equity: float   # at bar close
    worst: float    # worst intrabar mark-to-market (adverse extreme of the bar)


@dataclass
class BacktestResult:
    starting_equity: float
    trades: list[Trade]
    equity: list[EquityPoint]
    vetoes: dict[str, int] = field(default_factory=dict)
    approvals_skipped: int = 0
    halted_at: datetime | None = None
    halt_reason: str | None = None


class _NullNotifier:
    def send(self, text: str) -> None:
        pass


def run_backtest(
    candles: list[Candle],
    strategy: Strategy,
    cfg: RiskConfig,
    start_equity: float = 10_000.0,
    costs: CostModel = CostModel(),
    trade_from: datetime | None = None,
    trade_until: datetime | None = None,
    state_engine: StateEngine | None = None,
) -> BacktestResult:
    """Candles before `trade_from` are history only; bars in [trade_from, trade_until] are traded."""
    engine = state_engine or StateEngine()
    need = engine.min_candles
    idx = [j for j, c in enumerate(candles)
           if (trade_from is None or c.ts >= trade_from) and (trade_until is None or c.ts <= trade_until)]
    if not idx:
        return BacktestResult(start_equity, [], [])

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        broker = SimBroker(start_equity, costs.slippage_points)
        gate = RiskGate(cfg, KillSwitch(tmp / "kill.json"), EquityTracker(tmp / "eq.json"))
        router = OrderRouter(broker, gate, Journal(tmp / "j.sqlite", fast=True), _NullNotifier(), cfg)

        meta: dict[int, tuple[Snapshot | None, float]] = {}
        vetoes: Counter[str] = Counter()
        skipped = 0
        pending: tuple[OrderRequest, Snapshot] | None = None
        equity: list[EquityPoint] = []
        halted_at = halt_reason = None
        point = 0.01

        for j in idx:
            bar = candles[j]
            sp = bar.spread_points * point
            prev_close = candles[j - 1].close_ts if j > 0 else bar.ts
            # ---- open of bar j
            broker.set_market(
                MarketState(bar.ts, bar.open, bar.open + sp, prev_close, point), check_exits=False)
            broker.process_open()
            if pending is not None and not gate.kill_switch.is_tripped:
                order, snap = pending
                before = broker.account().equity
                res = router.submit(order, bar.ts)
                if res.status is Status.FILLED:
                    meta[res.fill.order_id] = (snap, before)
                elif res.status is Status.PENDING:
                    skipped += 1
                    router.deny(res.pending_id, bar.ts)
                elif res.status is Status.VETOED:
                    vetoes[re.sub(r"[\d.]+", "#", res.reason)] += 1
            pending = None
            broker.process_range(bar.high, bar.low, bar.spread_points, bar.ts)
            worst = broker.worst_case_equity(bar.high, bar.low, bar.spread_points)
            # ---- close of bar j
            broker.set_market(
                MarketState(bar.close_ts, bar.close, bar.close + sp, bar.close_ts, point), check_exits=False)
            if not gate.kill_switch.is_tripped:
                router.tick(bar.close_ts)
                if gate.kill_switch.is_tripped and halted_at is None:
                    halted_at, halt_reason = bar.close_ts, gate.kill_switch.reason()
            eq = broker.account().equity
            equity.append(EquityPoint(bar.close_ts, eq, min(eq, worst)))
            # ---- decision
            if not gate.kill_switch.is_tripped and j + 1 >= need:
                snap = engine.snapshot(candles[j + 1 - need: j + 1], bar.close_ts)
                if snap is not None:
                    ctx = Context(bar.close_ts, broker.positions(), broker.account())
                    order = strategy(snap, ctx)
                    if order is not None:
                        pending = (order, snap)

        last = candles[idx[-1]]
        broker.flatten_all(last.close_ts, "end_of_data")

        trades = []
        for cp in broker.closed:
            p = cp.position
            snap, eq_before = meta.get(p.id, (None, start_equity))
            trades.append(Trade(p.opened_at, cp.exit_ts, p.side, p.lots, p.entry, cp.exit,
                                cp.pnl, cp.reason, eq_before, snap))
        trades.sort(key=lambda t: (t.exit_ts, t.entry_ts))
        return BacktestResult(start_equity, trades, equity, dict(vetoes), skipped, halted_at, halt_reason)
