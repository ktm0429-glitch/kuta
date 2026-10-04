"""Regime breakdown of trades by their ENTRY snapshot, split at sample medians (no magic thresholds)."""
from __future__ import annotations

import statistics
from dataclasses import dataclass

from .backtest import Trade


@dataclass(frozen=True)
class RegimeStat:
    n: int
    hit_rate_pct: float
    pnl: float


def _strength(t: Trade) -> float:
    s = t.snapshot
    return abs(s.trend) / s.realized_vol if s and s.realized_vol > 0 else 0.0


def regime_breakdown(trades: list[Trade]) -> dict[str, RegimeStat]:
    with_snap = [t for t in trades if t.snapshot is not None]
    if not with_snap:
        return {}
    vol_med = statistics.median(t.snapshot.realized_vol for t in with_snap)
    str_med = statistics.median(_strength(t) for t in with_snap)
    groups: dict[str, list[Trade]] = {}
    for t in with_snap:
        label = ("high_vol" if t.snapshot.realized_vol > vol_med else "low_vol") + "/" + \
                ("trend" if _strength(t) > str_med else "range")
        groups.setdefault(label, []).append(t)
    return {
        k: RegimeStat(len(v), sum(t.pnl > 0 for t in v) / len(v) * 100, sum(t.pnl for t in v))
        for k, v in sorted(groups.items())
    }
