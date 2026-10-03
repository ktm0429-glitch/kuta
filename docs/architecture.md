# XAUUSD Trading Bot — Architecture (draft v0.1)

Status: **awaiting approval** (spec approved; supersedes broker section of spec.md: OANDA -> TitanFX)

## 1. Broker change: TitanFX (MT5)
TitanFX has no REST/streaming API. Access is through the MetaTrader 5 terminal.
Consequences:
- Python `MetaTrader5` package is **Windows-only**. The execution host must run the MT5 terminal on Windows (Windows VPS). systemd is replaced by a Windows service (NSSM) or Task Scheduler with restart-on-failure.
- Research/backtest/nightly review can run anywhere (Linux) on exported CSV data.
- **Paper = TitanFX demo account** (same symbol, spreads and contract specs as live; fills are simulated by broker).
- **No passwords handled by the bot**: user logs in to MT5 terminal manually once; the bot calls `mt5.initialize()` and attaches to the logged-in terminal. No account password, no 2FA, no secrets for the broker. Withdrawals are not possible via MT5, so the "withdrawals off" rule is satisfied structurally; use the **investor (read-only) password** for any monitoring-only host.
- Symbol: confirm exact Titan symbol name (e.g. `XAUUSD` vs suffix) and account type (Standard/Blade) — Blade has raw spreads + commission, which the cost model must include.
- Order book imbalance: MT5 Depth of Market for XAUUSD is generally unavailable from FX brokers. Use tick-volume/spread/tick-direction proxies; documented in the state engine.

## 2. Layers (never overlap)
```
 MT5 terminal (Windows)          Linux or same host
 ┌────────────────────┐   ┌───────────────────────────────────────────────┐
 │ ticks / candles    │──▶│ data adapter (MT5 live | CSV replay)          │
 │ order execution    │◀──│ broker adapter (MT5 demo | simulated)          │
 └────────────────────┘   │                                               │
                          │ state engine  ──▶ Scorer (interface)          │
                          │   (deterministic)   ├ LocalScorer (v1)        │
                          │                     └ JevScorer  (later)      │
                          │ decision engine (weights, thresholds)         │
                          │ sizing (capped fractional Kelly)              │
                          │ RISK GATE (veto, kill switch, approval)       │
                          │ order router ──▶ broker adapter               │
                          │ journal (SQLite) ─▶ calibration, reports      │
                          │ dashboard (read-only) · Telegram notifier     │
                          └───────────────────────────────────────────────┘
 Slow brain (LLM, nightly, offline): strategy.md + question rewrites,
 only ships if backtest gate passes. Never in the order path.
```

## 3. Modules (Python 3.11, each test-first)
| Module | Responsibility |
|---|---|
| `config` | Load `.env` + `risk.yaml` (limits live in code/config, not prompts). Secrets never logged |
| `data` | `CandleSource` interface: `MT5Source`, `CsvSource`. Enforces strictly-before-decision timestamps |
| `state` | Candle -> compact numeric snapshot (price, spread, imbalance proxy, realized vol, trend, recent flow) |
| `scorer` | `Scorer.score(snapshot) -> {regime, direction, buying_pressure, setup_quality, risk_state}` as probabilities. `LocalScorer` v1; `JevScorer` adapter stub |
| `decision` | Combine question outputs with explicit weights; fire only if all probabilities >= thresholds in `strategy.md` |
| `sizing` | 0.25 x Kelly cap, scaled by confidence, zero below cutoff; rounds to broker lot step |
| `risk` | Max position, daily loss, max drawdown, kill switch (flatten + halt, persisted so restart stays halted), manual-approval gate above threshold. Called before every order; cannot be overridden by scorer/LLM |
| `broker` | `Broker` interface: `Mt5Broker` (demo), `SimBroker` (backtest) |
| `backtest` | Event-driven, spread + slippage + commission, walk-forward / out-of-sample split, regime breakdown; gate check (Sharpe>1.5, DD<15%, hit>55%, t>2.0) |
| `journal` | SQLite log of every decision, probability, action, fill, outcome |
| `calibration` | Brier score, reliability curve per question, Platt/isotonic recalibration in code |
| `notify` | Telegram alerts: fill, error, escalation, kill switch |
| `dashboard` | Local read-only web page (signal, prob, confidence, action, result), live-updating |
| `report` | Daily report: trades, P&L, win rate, largest loss, scorer latency/cost, calibration |
| `review` | Nightly LLM review input pack + gate re-run before any rewrite is accepted |

## 4. Data flow per candle
1. `data` delivers closed candle(s). 2. `state` builds snapshot (only past data). 3. `scorer` returns probabilities (<1s, no text). 4. `decision` checks thresholds from `strategy.md`. 5. `sizing`. 6. `risk` gate (veto or require approval). 7. `broker` order. 8. `journal` + `notify`. Any exception at any step => no trade, alert, and 3 consecutive errors => kill switch.

## 5. Safety invariants (each has a failing test first)
- Risk gate runs before every order; no code path to `broker.send` bypasses it.
- Kill switch flattens, halts, and survives restart.
- Daily loss / drawdown breach triggers kill switch automatically.
- Orders above approval threshold stay pending until user confirms (Telegram button), with timeout -> cancel.
- Live mode requires an explicit `LIVE_ENABLED` flag **and** a recorded approval file; default is demo only.
- News/headline text is never fed into any prompt that can change orders.
- Stale data (> 2 candles old), spread spike, or MT5 disconnect => no trading.

## 6. Data for backtest
Export >= 2 years of M1 (and ticks if available) from TitanFX MT5 to CSV; place outside git. Broker history depth may limit this — verify in Plan phase.

## 7. Deployment
Windows VPS: MT5 terminal (logged in manually, auto-start) + bot as NSSM service with restart-on-failure, `.env` with only Telegram token/chat id. Heartbeat alert if no candle processed for N minutes.

## 8. Open questions for the Plan phase
1. Windows VPS available (e.g. Titan-provided or other)? Otherwise Mac Mini/Linux cannot run MT5 natively.
2. Exact symbol name and account type; typical spread/commission.
3. Approval threshold (proposed: > 0.05 lot).
4. Candle timeframe (proposed: decide on M5).
