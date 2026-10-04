import random
from datetime import datetime, timedelta, timezone

import pytest

from xbot.backtest import CostModel, run_backtest
from xbot.models import Candle, OrderRequest, Side

T0 = datetime(2026, 1, 5, 0, 0, tzinfo=timezone.utc)
TF = 300
WARM = 25  # flat bars so the state engine has history


def bar(i, o, h=None, l=None, c=None, spread=20):
    h = o if h is None else h
    l = o if l is None else l
    c = o if c is None else c
    return Candle(T0 + timedelta(seconds=TF * i), o, h, l, c, 100, spread, TF)


def flat(n, start=0, px=2000.0):
    return [bar(start + i, px) for i in range(n)]


def once(order, at_idx=WARM - 1):
    """Strategy that emits `order` once, at the close of bar `at_idx`."""
    state = {"done": False}

    def strat(snap, ctx):
        if not state["done"] and snap.ts == T0 + timedelta(seconds=TF * (at_idx + 1)):
            state["done"] = True
            return order
        return None
    return strat


def buy(lots=0.02, sl=1990.0, tp=2010.0):
    return OrderRequest(Side.BUY, lots, sl, tp, "t")


def sell(lots=0.02, sl=2010.0, tp=1990.0):
    return OrderRequest(Side.SELL, lots, sl, tp, "t")


def run(candles, order, cfg, slip=0.0, **kw):
    return run_backtest(candles, once(order), cfg, start_equity=10_000.0,
                        costs=CostModel(slippage_points=slip), **kw)


def test_flat_market_costs_exactly_the_spread(cfg):
    r = run(flat(WARM + 10), buy(), cfg)
    t = r.trades[0]
    assert t.exit_reason == "end_of_data"
    assert t.entry == pytest.approx(2000.20) and t.exit == pytest.approx(2000.00)
    assert t.pnl == pytest.approx(-0.40)


def test_take_profit_long(cfg):
    cs = flat(WARM + 1) + [bar(WARM + 1, 2000, h=2011, l=2000, c=2010.5)] + flat(3, WARM + 2, 2010.5)
    t = run(cs, buy(), cfg).trades[0]
    assert t.exit_reason == "tp" and t.exit == pytest.approx(2010.0)
    assert t.pnl == pytest.approx((2010.0 - 2000.20) * 2)


def test_stop_loss_long(cfg):
    cs = flat(WARM + 1) + [bar(WARM + 1, 2000, h=2000, l=1989, c=1990)] + flat(3, WARM + 2, 1990)
    t = run(cs, buy(), cfg).trades[0]
    assert t.exit_reason == "sl" and t.pnl == pytest.approx((1990.0 - 2000.20) * 2)


def test_slippage_applies_to_entry_and_stop_exit(cfg):
    cs = flat(WARM + 1) + [bar(WARM + 1, 2000, h=2000, l=1989, c=1990)] + flat(3, WARM + 2, 1990)
    t = run(cs, buy(), cfg, slip=10).trades[0]  # 10 points = 0.10
    assert t.entry == pytest.approx(2000.30) and t.exit == pytest.approx(1989.90)
    assert t.pnl == pytest.approx((1989.90 - 2000.30) * 2)


def test_gap_through_stop_fills_at_open_not_at_stop(cfg):
    cs = flat(WARM + 1) + [bar(WARM + 1, 1985, h=1986, l=1984, c=1985)] + flat(3, WARM + 2, 1985)
    t = run(cs, buy(), cfg).trades[0]
    assert t.exit == pytest.approx(1985.0) and t.pnl == pytest.approx((1985.0 - 2000.20) * 2)


def test_stop_and_target_in_same_bar_assumes_stop_first(cfg):
    cs = flat(WARM + 1) + [bar(WARM + 1, 2000, h=2015, l=1985, c=2000)] + flat(3, WARM + 2, 2000)
    t = run(cs, buy(), cfg).trades[0]
    assert t.exit_reason == "sl"


def test_short_take_profit_uses_ask_for_exit(cfg):
    # low 1989.5 + spread 0.20 = 1989.70 <= tp 1990 -> exit at 1990 (ask)
    cs = flat(WARM + 1) + [bar(WARM + 1, 2000, h=2000, l=1989.5, c=1990)] + flat(3, WARM + 2, 1990)
    t = run(cs, sell(), cfg).trades[0]
    assert t.entry == pytest.approx(2000.0)
    assert t.exit_reason == "tp" and t.pnl == pytest.approx((2000.0 - 1990.0) * 2)


def test_short_stop_uses_ask(cfg):
    # high 2009.9 + 0.20 = 2010.10 >= sl 2010
    cs = flat(WARM + 1) + [bar(WARM + 1, 2000, h=2009.9, l=2000, c=2005)] + flat(3, WARM + 2, 2005)
    t = run(cs, sell(), cfg).trades[0]
    assert t.exit_reason == "sl" and t.pnl == pytest.approx((2000.0 - 2010.0) * 2)


def test_vetoed_order_is_counted_and_never_trades(cfg):
    r = run(flat(WARM + 5), buy(lots=0.5), cfg)
    assert r.trades == [] and sum(r.vetoes.values()) == 1


def test_order_needing_approval_is_skipped_unattended(cfg):
    r = run(flat(WARM + 5), buy(lots=0.06), cfg)
    assert r.trades == [] and r.approvals_skipped == 1


def test_wrong_side_stop_is_vetoed(cfg):
    r = run(flat(WARM + 5), OrderRequest(Side.BUY, 0.02, 2005.0, 2010.0, "bad"), cfg)
    assert r.trades == [] and sum(r.vetoes.values()) == 1


def test_daily_loss_trips_kill_switch_and_halts_trading(cfg):
    crash = bar(WARM + 1, 2000, h=2000, l=1955, c=1955)
    cs = flat(WARM + 1) + [crash] + flat(30, WARM + 2, 1955)

    def always(snap, ctx):
        return OrderRequest(Side.BUY, 0.05, 1900.0, 2100.0, "again")

    wide = cfg.model_copy(update={"max_risk_per_trade_pct": 10.0})  # this test is about the daily-loss limit
    r = run_backtest(cs, always, wide, 10_000.0, CostModel(0))
    assert r.halted_at is not None and "daily loss" in r.halt_reason
    assert len(r.trades) == 1 and r.trades[0].exit_reason == "flatten"


def test_trade_from_blocks_early_decisions(cfg):
    r = run(flat(WARM + 10), buy(), cfg, trade_from=T0 + timedelta(seconds=TF * (WARM + 5)))
    assert r.trades == []


def test_equity_curve_one_point_per_traded_bar(cfg):
    r = run(flat(WARM + 10), buy(), cfg)
    assert len(r.equity) == WARM + 10
    assert r.equity[0].equity == 10_000.0


def test_intrabar_worst_equity_is_recorded(cfg):
    dip = bar(WARM + 1, 2000, h=2000.5, l=1992, c=2000)  # dips 8, recovers; sl 1990 not hit
    r = run(flat(WARM + 1) + [dip] + flat(3, WARM + 2, 2000), buy(), cfg)
    p = r.equity[WARM + 1]
    assert p.worst < p.equity - 10  # 8.2 * 2 lots-ish


def test_trade_records_entry_snapshot_and_equity_before(cfg):
    t = run(flat(WARM + 5), buy(), cfg).trades[0]
    assert t.snapshot is not None and t.equity_before == pytest.approx(10_000.0)


def _walk(n, seed):
    rnd, px, out = random.Random(seed), 2000.0, []
    for i in range(n):
        o = px
        c = o + rnd.uniform(-1.5, 1.5)
        out.append(Candle(T0 + timedelta(seconds=TF * i), o, max(o, c) + 0.3, min(o, c) - 0.3, c,
                          rnd.randint(50, 300), 20, TF))
        px = c
    return out


def momentum(snap, ctx):
    if ctx.positions:
        return None
    if snap.flow > 0.3:
        return OrderRequest(Side.BUY, 0.02, snap.price - 3, snap.price + 3, "m")
    if snap.flow < -0.3:
        return OrderRequest(Side.SELL, 0.02, snap.price + 3, snap.price - 3, "m")
    return None


@pytest.mark.parametrize("k", [150, 233, 321])
def test_no_lookahead_truncating_future_does_not_change_past(cfg, k):
    cs = _walk(450, seed=k)
    full = run_backtest(cs, momentum, cfg, 10_000.0, CostModel(2))
    part = run_backtest(cs[:k], momentum, cfg, 10_000.0, CostModel(2))
    cut = cs[k - 1].close_ts
    key = lambda t: (t.entry_ts, t.exit_ts, t.side, round(t.pnl, 9))
    full_closed = [key(t) for t in full.trades if t.exit_ts <= cut and t.exit_reason != "end_of_data"]
    part_closed = [key(t) for t in part.trades if t.exit_reason != "end_of_data"]
    assert part_closed == full_closed and len(full_closed) > 0


def test_coin_flip_strategy_does_not_beat_costs_or_pass_gates(cfg):
    """Engine must not be optimistic: random trading on a random walk loses ~costs and fails the gates."""
    from xbot.gates import check_gates
    from xbot.metrics import compute_metrics
    from xbot.regimes import regime_breakdown

    cs = _walk(6000, seed=7)
    rnd = random.Random(3)

    def coin(snap, ctx):
        if ctx.positions or rnd.random() > 0.05:
            return None
        if rnd.random() < 0.5:
            return OrderRequest(Side.BUY, 0.02, snap.price - 4, snap.price + 4, "c")
        return OrderRequest(Side.SELL, 0.02, snap.price + 4, snap.price - 4, "c")

    r = run_backtest(cs, coin, cfg, 10_000.0, CostModel(2))
    m = compute_metrics(r)
    assert m.n_trades > 50 and m.expectancy < 0
    assert not check_gates(m, regimes=regime_breakdown(r.trades)).passed
