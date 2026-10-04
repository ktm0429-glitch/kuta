import math
import statistics
from datetime import datetime, timedelta, timezone

import pytest

from xbot.backtest import BacktestResult, EquityPoint, Trade
from xbot.metrics import compute_metrics
from xbot.models import Side

D0 = datetime(2026, 1, 5, 21, 0, tzinfo=timezone.utc)


def trade(pnl, eq_before=100.0, i=0, hold_min=30):
    t0 = D0 + timedelta(days=i)
    return Trade(t0, t0 + timedelta(minutes=hold_min), Side.BUY, 0.02, 2000, 2000, pnl, "tp", eq_before, None)


def result(trades=(), equities=(100.0,), start=100.0):
    pts = [EquityPoint(D0 + timedelta(days=i), e, e) for i, e in enumerate(equities)]
    return BacktestResult(start, list(trades), pts, {}, 0, None, None)


def test_no_trades():
    m = compute_metrics(result())
    assert m.n_trades == 0 and m.sharpe == 0 and m.t_stat == 0 and m.hit_rate_pct == 0


def test_hit_rate_and_profit_factor():
    m = compute_metrics(result([trade(1, i=0), trade(1, i=1), trade(-1, i=2), trade(1, i=3)]))
    assert m.hit_rate_pct == 75.0 and m.profit_factor == pytest.approx(3.0)
    assert m.avg_win == 1 and m.avg_loss == -1 and m.expectancy == 0.5


def test_t_stat_of_per_trade_returns():
    m = compute_metrics(result([trade(1, i=0), trade(1, i=1), trade(-1, i=2), trade(1, i=3)]))
    assert m.t_stat == pytest.approx(1.0)  # mean .005, sd .01, n=4


def test_t_stat_zero_when_single_trade():
    assert compute_metrics(result([trade(1)])).t_stat == 0


def test_max_drawdown_from_equity_curve():
    m = compute_metrics(result(equities=[100, 110, 99, 105, 90, 120]))
    assert m.max_drawdown_pct == pytest.approx(20 / 110 * 100)


def test_max_drawdown_uses_intrabar_worst():
    pts = [EquityPoint(D0, 100, 100), EquityPoint(D0 + timedelta(days=1), 100, 80)]
    r = BacktestResult(100.0, [], pts, {}, 0, None, None)
    assert compute_metrics(r).max_drawdown_pct == pytest.approx(20.0)


def test_total_return():
    m = compute_metrics(result(equities=[100, 110, 121], start=100.0))
    assert m.total_return_pct == pytest.approx(21.0)


def test_sharpe_from_daily_returns_annualized():
    eq = [100.0, 101.0, 100.5, 102.0, 103.0]
    rets = [b / a - 1 for a, b in zip([100.0] + eq[:-1], eq)]
    expected = statistics.mean(rets) / statistics.stdev(rets) * math.sqrt(252)
    assert compute_metrics(result(equities=eq, start=100.0)).sharpe == pytest.approx(expected)


def test_sharpe_uses_last_equity_of_each_day():
    pts = []
    for d, vals in enumerate([(100.0, 101.0), (101.0, 100.0), (100.0, 102.0)]):
        for k, v in enumerate(vals):
            pts.append(EquityPoint(D0.replace(hour=1 + k) + timedelta(days=d), v, v))
    r = BacktestResult(100.0, [], pts, {}, 0, None, None)
    daily = [101.0, 100.0, 102.0]
    rets = [b / a - 1 for a, b in zip([100.0] + daily[:-1], daily)]
    assert compute_metrics(r).sharpe == pytest.approx(statistics.mean(rets) / statistics.stdev(rets) * math.sqrt(252))


def test_sharpe_zero_when_flat():
    assert compute_metrics(result(equities=[100, 100, 100])).sharpe == 0


def test_avg_hold_minutes():
    m = compute_metrics(result([trade(1, hold_min=30, i=0), trade(1, hold_min=90, i=1)]))
    assert m.avg_hold_minutes == 60
