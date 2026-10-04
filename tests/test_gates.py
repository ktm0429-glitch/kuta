from datetime import datetime, timezone

import pytest

from xbot.backtest import Trade
from xbot.gates import GateThresholds, check_gates
from xbot.metrics import Metrics
from xbot.models import Side
from xbot.regimes import regime_breakdown
from xbot.state import Snapshot

GOOD = dict(n_trades=200, total_return_pct=30, sharpe=2.0, max_drawdown_pct=8.0, hit_rate_pct=58.0,
            t_stat=2.8, profit_factor=1.6, avg_win=2, avg_loss=-1, expectancy=0.5, avg_hold_minutes=40)


def m(**kw):
    return Metrics(**{**GOOD, **kw})


def test_all_gates_pass():
    r = check_gates(m())
    assert r.passed and all(c.passed for c in r.checks.values())


@pytest.mark.parametrize(
    "kw,name",
    [
        (dict(sharpe=1.4), "sharpe"), (dict(sharpe=1.5), "sharpe"),
        (dict(max_drawdown_pct=15.0), "max_drawdown"), (dict(max_drawdown_pct=20), "max_drawdown"),
        (dict(hit_rate_pct=55.0), "hit_rate"), (dict(hit_rate_pct=50), "hit_rate"),
        (dict(t_stat=2.0), "t_stat"), (dict(t_stat=1.0), "t_stat"),
        (dict(n_trades=99), "min_trades"),
    ],
)
def test_each_gate_fails_independently(kw, name):
    r = check_gates(m(**kw))
    assert not r.passed and not r.checks[name].passed
    assert [k for k, c in r.checks.items() if not c.passed] == [name]


def test_exactly_min_trades_passes():
    assert check_gates(m(n_trades=100)).passed


def test_custom_thresholds():
    assert check_gates(m(sharpe=1.2), GateThresholds(sharpe_min=1.0)).passed


def snap(vol, trend):
    return Snapshot(datetime(2026, 1, 5, tzinfo=timezone.utc), 2000, 20, 0, vol, trend, 0)


def tr(pnl, vol, trend):
    t = datetime(2026, 1, 5, tzinfo=timezone.utc)
    return Trade(t, t, Side.BUY, 0.02, 2000, 2000, pnl, "tp", 100.0, snap(vol, trend))


def test_regime_breakdown_splits_by_vol_and_trend_strength():
    trades = [tr(1, 0.001, 0.0001), tr(1, 0.001, 0.0009), tr(-1, 0.003, 0.0001), tr(-1, 0.003, 0.0100)]
    reg = regime_breakdown(trades)
    assert sum(s.n for s in reg.values()) == 4
    assert set(reg) <= {"low_vol/range", "low_vol/trend", "high_vol/range", "high_vol/trend"}


def test_regime_gate_requires_most_regimes_positive():
    trades = []
    for label, pnl, vol, trend in [("a", 1, .001, .0001), ("b", 1, .001, .01), ("c", 1, .003, .0001), ("d", -1, .003, .01)]:
        trades += [tr(pnl, vol, trend) for _ in range(30)]
    reg = regime_breakdown(trades)
    assert check_gates(m(), regimes=reg).passed  # 3 of 4 positive = 75%
    trades2 = [tr(1 if (v, t) == (.001, .0001) else -1, v, t) for v, t in [(.001, .0001), (.001, .01), (.003, .0001), (.003, .01)] for _ in range(30)]
    bad = check_gates(m(), regimes=regime_breakdown(trades2))
    assert not bad.passed and not bad.checks["regimes_positive"].passed


def test_small_regimes_are_ignored_by_regime_gate():
    reg = regime_breakdown([tr(-1, .001, .0001) for _ in range(5)] + [tr(1, .003, .01) for _ in range(40)])
    assert check_gates(m(), regimes=reg).checks["regimes_positive"].passed
