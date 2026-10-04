"""End to end: fit scorer on the past, run Brain through the real backtest engine on the future."""
import pytest

pytest.importorskip("numpy")

from test_scorer import SPEC, planted  # noqa: E402
from xbot.backtest import CostModel, run_backtest  # noqa: E402
from xbot.brain import Brain  # noqa: E402
from xbot.labels import LabelSpec  # noqa: E402
from xbot.metrics import compute_metrics  # noqa: E402
from xbot.scorer import LocalScorer  # noqa: E402
from xbot.strategy_rules import load_strategy  # noqa: E402


def test_fitted_brain_runs_through_backtest_and_logs_every_decision(cfg):
    rules = load_strategy("strategy.example.md")
    cs, _ = planted(30_000, seed=11)
    train, test = cs[:16_000], cs[16_000:]
    scorer = LocalScorer.fit(train, LabelSpec.from_rules(rules))
    records = []
    brain = Brain(scorer, rules, cfg, calibrated=False, sink=records.append)
    res = run_backtest(cs, brain, cfg, 10_000.0, CostModel(2), trade_from=test[0].ts)

    assert len(records) > 100                      # decisions were logged, including "none"
    assert res.equity[0].ts > test[0].ts
    assert all(r.snapshot.ts >= test[0].ts for r in records)
    assert all(t.lots == pytest.approx(0.01) for t in res.trades)  # uncalibrated => probe size only
    m = compute_metrics(res)
    print("integration:", m.n_trades, "trades, hit", round(m.hit_rate_pct, 1), "return", round(m.total_return_pct, 3))
