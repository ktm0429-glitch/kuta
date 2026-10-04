"""Anchored (expanding-window) walk-forward. Strategies are fitted ONLY on data before the test fold."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from .backtest import BacktestResult, CostModel, Strategy, run_backtest
from .config import RiskConfig
from .models import Candle


@dataclass(frozen=True)
class Fold:
    train_end: int   # exclusive index: training uses candles[:train_end]
    test_start: int
    test_end: int    # exclusive


def make_folds(n: int, n_folds: int, initial_train_frac: float, embargo: int) -> list[Fold]:
    if n_folds < 1 or not (0 < initial_train_frac < 1) or embargo < 0:
        raise ValueError("invalid walk-forward arguments")
    start = int(n * initial_train_frac)
    size = (n - start) // n_folds
    if size < 1 or start - embargo < 1:
        raise ValueError("not enough data for the requested folds")
    folds = []
    for k in range(n_folds):
        a = start + k * size
        b = n if k == n_folds - 1 else a + size
        folds.append(Fold(a - embargo, a, b))
    return folds


@dataclass
class WalkForwardResult:
    folds: list[BacktestResult]
    combined: BacktestResult
    fold_defs: list[Fold]


def run_walk_forward(
    candles: list[Candle],
    fit: Callable[[list[Candle]], Strategy],
    cfg: RiskConfig,
    n_folds: int,
    initial_train_frac: float,
    embargo: int,
    costs: CostModel = CostModel(),
    start_equity: float = 10_000.0,
) -> WalkForwardResult:
    defs = make_folds(len(candles), n_folds, initial_train_frac, embargo)
    results, equity = [], start_equity
    for f in defs:
        strategy = fit(candles[: f.train_end])
        r = run_backtest(candles, strategy, cfg, equity, costs,
                         trade_from=candles[f.test_start].ts, trade_until=candles[f.test_end - 1].ts)
        results.append(r)
        equity = r.equity[-1].equity if r.equity else equity  # carry equity forward
    vetoes: dict[str, int] = {}
    for r in results:
        for k, v in r.vetoes.items():
            vetoes[k] = vetoes.get(k, 0) + v
    halted = next((r for r in results if r.halted_at), None)
    combined = BacktestResult(
        start_equity,
        [t for r in results for t in r.trades],
        [p for r in results for p in r.equity],
        vetoes,
        sum(r.approvals_skipped for r in results),
        halted.halted_at if halted else None,
        halted.halt_reason if halted else None,
    )
    return WalkForwardResult(results, combined, defs)
