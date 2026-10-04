from __future__ import annotations

import math
import statistics
from dataclasses import dataclass

from .backtest import BacktestResult

TRADING_DAYS = 252


@dataclass(frozen=True)
class Metrics:
    n_trades: int
    total_return_pct: float
    sharpe: float             # daily equity returns, annualized with sqrt(252)
    max_drawdown_pct: float   # from running peak of bar-close equity to worst intrabar equity
    hit_rate_pct: float
    t_stat: float             # mean/stdev*sqrt(n) of per-trade returns (pnl / equity before the trade)
    profit_factor: float
    avg_win: float
    avg_loss: float
    expectancy: float
    avg_hold_minutes: float


def _sharpe(r: BacktestResult) -> float:
    daily: dict = {}
    for p in r.equity:
        daily[p.ts.date()] = p.equity  # last point of each UTC day wins
    vals = [r.starting_equity] + list(daily.values())
    rets = [b / a - 1 for a, b in zip(vals, vals[1:]) if a > 0]
    if len(rets) < 2:
        return 0.0
    sd = statistics.stdev(rets)
    return 0.0 if sd == 0 else statistics.fmean(rets) / sd * math.sqrt(TRADING_DAYS)


def _max_dd(r: BacktestResult) -> float:
    peak, dd = r.starting_equity, 0.0
    for p in r.equity:
        peak = max(peak, p.equity)
        dd = max(dd, (peak - min(p.equity, p.worst)) / peak * 100 if peak > 0 else 0.0)
    return dd


def compute_metrics(r: BacktestResult) -> Metrics:
    pnls = [t.pnl for t in r.trades]
    n = len(pnls)
    wins = [x for x in pnls if x > 0]
    losses = [x for x in pnls if x < 0]
    rets = [t.pnl / t.equity_before for t in r.trades if t.equity_before > 0]
    t_stat = 0.0
    if len(rets) >= 2:
        sd = statistics.stdev(rets)
        t_stat = 0.0 if sd == 0 else statistics.fmean(rets) / sd * math.sqrt(len(rets))
    last_eq = r.equity[-1].equity if r.equity else r.starting_equity
    gross_loss = abs(sum(losses))
    return Metrics(
        n_trades=n,
        total_return_pct=(last_eq - r.starting_equity) / r.starting_equity * 100,
        sharpe=_sharpe(r),
        max_drawdown_pct=_max_dd(r),
        hit_rate_pct=len(wins) / n * 100 if n else 0.0,
        t_stat=t_stat,
        profit_factor=(sum(wins) / gross_loss) if gross_loss else (math.inf if wins else 0.0),
        avg_win=statistics.fmean(wins) if wins else 0.0,
        avg_loss=statistics.fmean(losses) if losses else 0.0,
        expectancy=statistics.fmean(pnls) if n else 0.0,
        avg_hold_minutes=statistics.fmean((t.exit_ts - t.entry_ts).total_seconds() / 60 for t in r.trades) if n else 0.0,
    )
