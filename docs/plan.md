# XAUUSD Trading Bot — Implementation Plan (draft v0.1)

Status: **awaiting approval**. No code is written until this is approved.

## Confirmed inputs
- Execution host: user's dedicated Windows EA PC running MT5 (TitanFX, Standard account, demo for paper).
- Timeframe M5. Manual approval for any order > 0.05 lot.
- Standard account: no commission, spread built into price. Cost model uses measured spread + slippage.
- Linux (this env) for research, tests, backtests; Windows PC for MT5 data export and live/paper run.

## Rules for every module
1. Write the failing test first, see it fail, then implement.
2. Review against spec.md and architecture.md before merge.
3. Each module lands as its own commit/branch step so it can be reverted (rollback = `git revert` of that commit; runtime rollback = `LIVE_ENABLED` off + kill switch).
4. Stack: Python 3.11, pytest, pydantic, SQLite, pandas/numpy, scikit-learn, FastAPI (dashboard), python-telegram-bot or plain HTTPS.

## Milestones
| # | Milestone | Modules | Exit criteria |
|---|---|---|---|
| M0 | Scaffold | repo layout, config, `.env.example`, `.gitignore` (.env, data/), CI-less local pytest | `pytest` runs; secrets never logged (test) |
| M1 | Safety core first | `risk`, `broker` interface + `SimBroker`, `journal` | Tests: gate before every order, kill switch flattens + persists across restart, daily loss/DD triggers, approval > 0.05 lot, stale data/spread spike veto |
| M2 | Data + state | `data` (CsvSource, MT5Source), `state` | Tests: no lookahead (property test on timestamps), deterministic snapshot, M5 candle boundaries |
| M3 | Data export | `tools/export_mt5.py` for the Windows PC | User runs it; >= 2y M5/M1 XAUUSD CSV produced; real symbol name, spread stats, lot step/min recorded |
| M4 | Backtest engine | `backtest`, cost model, gate checker | Tests on synthetic data with known answers; walk-forward split; gate report (Sharpe, DD, hit rate, t-stat, regime breakdown) |
| M5 | Scorer + decision + sizing | `scorer` (LocalScorer, JevScorer stub), `decision`, `sizing` | Tests: fixed-outcome schema, probabilities in [0,1], Kelly cap 0.25, zero below cutoff; latency < 100 ms |
| M6 | Strategy search | candidates run via harness; winner -> `strategy.md` | **Only if** gates pass out of sample. If none pass: report and do not proceed to trading |
| M7 | Calibration | `calibration` | Brier + reliability per question; recalibration unit tests |
| M8 | Paper runner | `Mt5Broker` (demo), runner loop, `notify`, `dashboard`, `report` | Runs on demo; Telegram alerts for fill/error/escalation/kill; kill switch fired in a deliberate test |
| M9 | Nightly self-improvement | `review` | Rewrite accepted only after re-passing gates; each loss logs one new rule |
| M10 | Ship to EA PC | NSSM service, auto-start, heartbeat alert, runbook | Restart test passes; demo running 24h without intervention |
| M11 | Live readiness review | final check | Paper vs backtest comparison, calibration on own fills, "WHAT COULD BLOW UP THIS ACCOUNT?" answered; **live stays blocked until you approve** |

## Approval gates ahead
- This plan -> then M0-M2 can start.
- After M4/M6: you see backtest numbers before anything goes to paper.
- Before M11: explicit written approval to enable live.

## What I need from you, and when
- Now: approve architecture + this plan (or edit).
- At M3: run the export script on the EA PC and send me the CSV (or put it somewhere I can access) and the symbol info output.
- At M8: Telegram bot token + chat id into `.env` on the EA PC (never in chat or git).
- Broker credentials are never needed; you log in to MT5 yourself.

## Known risks
- Gates (Sharpe 1.5 / DD 15% / hit 55% / t 2.0) may reject every candidate. That is a valid outcome.
- Standard-account XAUUSD spread is wide and widens on news/rollover; M5 edges can vanish after costs.
- Broker history depth may be < 2 years at M5/M1.
- Demo fills are optimistic vs live; paper-vs-backtest match is necessary, not sufficient.
