# Strategy acceptance gates (M4)

Evaluated on **out-of-sample walk-forward results only** (anchored expanding window, embargo between train and test).

| Gate | Rule | Source |
|---|---|---|
| Sharpe | > 1.5 (daily equity returns, sqrt(252)) | spec |
| Max drawdown | < 15% (peak close-equity to worst intrabar equity) | spec |
| Hit rate | > 55% | spec |
| t-statistic | > 2.0 (per-trade returns) | spec |
| Min trades | >= 100 | **added guard** — a handful of lucky trades proves nothing |
| Regime robustness | profitable in >= 75% of regimes having >= 30 trades | **added guard** — "several market regimes" from the spec; regimes = {low,high vol} x {range,trend}, split at sample medians |

All inequalities are strict, so a value exactly at the threshold fails.

## What the backtest models
- Spread from the data (bars are bid; ask = bid + spread). Entry at the next bar's open after the decision.
- Slippage (default 2 points) against us on entries and stop exits. Gaps fill at the open, not the stop.
- Stop and target in the same bar: stop assumed first.
- Same RiskGate / router / kill switch as paper trading; orders needing manual approval are skipped (unattended).
- NOT modeled: swap/rollover, commission (none on Standard), partial fills, requotes, news-time spread spikes beyond the bar's recorded spread.

## Sanity checks in the test suite
- Known-answer trades (spread cost, TP, SL, gap, tie-break, short side, slippage).
- Truncating future data never changes past trades (no lookahead).
- A random coin-flip strategy loses roughly the cost and fails the gates (30/30 failed in an ad-hoc 30-seed run).
