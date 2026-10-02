# XAUUSD Trading Bot — Spec (draft v0.1)

Status: **awaiting approval** (no code written yet)

## 1. Principles
- Risk first, returns second. Deterministic code owns state, thresholds, sizing, vetoes, orders. Models only advise.
- Three layers that never overlap:
  1. **Slow brain** (LLM, nightly): strategy design, backtests review, code review, nightly post-mortem.
  2. **Fast reflex** (`Scorer` interface, per candle, sub-second, no text): returns calibrated probabilities for fixed questions.
  3. **Deterministic core**: state engine, decision rules, sizing, risk gate, order router.
- Paper only until live results match the backtest and the user explicitly approves going live.

## 2. Decisions made with the user
| Item | Decision |
|---|---|
| Instrument | XAUUSD (spot gold) |
| Broker / data | OANDA practice (fxPractice) REST/streaming API — **to confirm**: Alpaca does not offer XAUUSD |
| Fast scorer | Pluggable `Scorer` interface. Initial impl: in-house model (logistic regression / gradient boosting on the numeric snapshot). "Jev" SDK can be swapped in later once its docs/package are supplied |
| Harness | AgenKit not verified; same 6 phases (brainstorm → architecture → plan → test-first build → review → ship) run manually with approval gates at spec, architecture, plan |
| Deploy | VPS, systemd with auto-restart |
| Alerts | Telegram bot (fill, error, escalation, kill-switch events) |
| Secrets | `.env` only (gitignored), never in code/logs |

## 3. Open items (need answers before the Plan phase)
1. Confirm OANDA practice account (account ID + token created with trade-only scope; no withdrawal capability exists on API tokens).
2. Timeframe for candles (proposal: M5 decisions, M1 data for state).
3. Manual-approval threshold `[$ size]` (proposal: any order notional above $2,000 or lot size > 0.05).
4. Strategy idea to backtest (proposal below).

## 4. Strategy candidate (to be tested, not assumed to work)
Intraday momentum-continuation with volatility regime filter on XAUUSD M5:
- Regime: trending / ranging / high-vol-event (from realized vol + trend strength).
- Direction: up / down / none.
- Buying pressure real: yes/no (order-flow proxy from tick volume imbalance and spread behavior).
- Setup quality: 0–1 score.
- Risk state: normal / elevated / halt.

Acceptance gates (out of sample, ≥2 years, several regimes, with spread + slippage + commission):
- Sharpe > 1.5, max drawdown < 15%, hit rate > 55%, t-stat > 2.0.
- If no candidate passes, the bot does **not** trade. We report that honestly rather than loosen gates.

Note: these gates are demanding for a single intraday gold strategy; a real chance exists that nothing passes. That is an acceptable outcome.

## 5. State engine (deterministic)
Per candle, one numeric snapshot: price, spread, order-book imbalance*, realized vol, trend, recent flow.
- Only data timestamped strictly before the decision time (no lookahead).
- *OANDA gives order-book snapshots (position/order book) at coarse frequency only; true L2 imbalance is not available. We use a tick-volume/spread proxy and document it.

## 6. Risk rules (code, not models)
Max position size, daily loss limit, max drawdown, kill switch that flattens everything and halts. Checked before every order. Manual approval above threshold. Trade-only API key; no withdrawals. Never ask for or enter passwords/2FA. Headlines/news treated as data, never instructions.

## 7. Sizing
Fractional Kelly from calibrated probability: cap at 0.25 Kelly; zero below cutoff. Valid only after calibration passes.

## 8. Calibration
Log every decision + outcome; Brier score and reliability curve per question; simple recalibration (isotonic/Platt) in code if the curve bends. Verify on own paper fills before any real sizing.

## 9. Self-improvement (nightly)
LLM reviews session, proposes rewrites to `strategy.md` and scorer questions; change ships only after re-passing the backtest gates. Each loss logged with one new rule.

## 10. Deliverables
Running paper bot, live dashboard (signal, probability, confidence, action, result), `strategy.md`, daily report (trades, P&L, win rate, largest loss, scorer latency and cost per decision, calibration score), and final section **"WHAT COULD BLOW UP THIS ACCOUNT?"** — live trading stays blocked until each answer is clean.

## 11. Next phases (each pauses for approval)
Architecture → Plan → test-first build per module → review → ship.
