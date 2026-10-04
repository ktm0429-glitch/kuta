# Calibration (M7)

Sizing trusts the scorer's probabilities, so they are verified first. Until the check below passes,
the Brain trades only the 0.01 lot **probe size**.

## What is measured (per question, on data the scorer was not trained on — ideally TitanFX data)
- Brier score and **Brier skill** vs a constant base-rate predictor (must be > 0)
- Reliability curve (10 bins) and **ECE** (must be <= 0.05)
- Logistic **slope/intercept** of outcome on logit(p) (slope must be within 0.8–1.2; <1 overconfident, >1 underconfident)
- **Own fills**: for the trades the bot actually took, predicted p_win vs take-profit-before-stop outcomes
  (>= 30 resolved trades; |z| <= 2 for expected vs actual wins)

Questions with an objective outcome: direction_up/down, pressure_real, quality_up/down (+ trade_win).
Sizing depends on quality_up/down, so those two are the blocking ones. regime / risk_state are heuristics
with no objective label and are not calibrated.

## Rules
- Every scored bar is logged (`journal_sink`), traded or not, so the curve has no selection bias.
- Outcomes are resolved only from candles after the decision; decisions without a full horizon are dropped.
- If the curve bends: `recalibrators_from(preds, "platt" | "isotonic")` + `CalibratedScorer`. Fit the recalibrator on
  one period and verify on a later one; re-run `check_calibration` — a repaired curve must pass the same gate.
- The check is re-run continuously in paper mode; if it stops passing, sizing falls back to probe size.
- Jev is calibrated against its own training data, not this venue: it goes through the same gate before it is sized.

## Caveat
Thresholds are conservative defaults chosen by me, not derived from data. Small samples can pass by luck; the
sample-size minimums (300 bars/question, 30 trades) are floors, not targets.
