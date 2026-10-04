"""Acceptance gates for a strategy. Evaluate on OUT-OF-SAMPLE results only.

Spec gates: Sharpe > 1.5, max drawdown < 15%, hit rate > 55%, t-stat > 2.0 (all strict).
Added guards: >= 100 trades, and profitable in >= 75% of regimes that have >= 30 trades.
"""
from __future__ import annotations

from dataclasses import dataclass

from .metrics import Metrics
from .regimes import RegimeStat


@dataclass(frozen=True)
class GateThresholds:
    sharpe_min: float = 1.5
    max_drawdown_max: float = 15.0
    hit_rate_min: float = 55.0
    t_stat_min: float = 2.0
    min_trades: int = 100
    regime_positive_share: float = 0.75
    regime_min_trades: int = 30


@dataclass(frozen=True)
class GateCheck:
    value: float
    threshold: float
    passed: bool


@dataclass(frozen=True)
class GateResult:
    passed: bool
    checks: dict[str, GateCheck]


def check_gates(
    m: Metrics,
    th: GateThresholds = GateThresholds(),
    regimes: dict[str, RegimeStat] | None = None,
) -> GateResult:
    checks = {
        "sharpe": GateCheck(m.sharpe, th.sharpe_min, m.sharpe > th.sharpe_min),
        "max_drawdown": GateCheck(m.max_drawdown_pct, th.max_drawdown_max, m.max_drawdown_pct < th.max_drawdown_max),
        "hit_rate": GateCheck(m.hit_rate_pct, th.hit_rate_min, m.hit_rate_pct > th.hit_rate_min),
        "t_stat": GateCheck(m.t_stat, th.t_stat_min, m.t_stat > th.t_stat_min),
        "min_trades": GateCheck(m.n_trades, th.min_trades, m.n_trades >= th.min_trades),
    }
    if regimes is not None:
        big = [s for s in regimes.values() if s.n >= th.regime_min_trades]
        share = sum(s.pnl > 0 for s in big) / len(big) if big else 0.0
        checks["regimes_positive"] = GateCheck(share, th.regime_positive_share, bool(big) and share >= th.regime_positive_share)
    return GateResult(all(c.passed for c in checks.values()), checks)
