from datetime import timedelta

import pytest

from conftest import make_account, make_market, make_order
from xbot.risk import ApprovedOrder, EquityTracker, KillSwitch, RiskGate, VerdictKind


@pytest.fixture
def gate(cfg, tmp_path):
    return RiskGate(cfg, KillSwitch(tmp_path / "kill.json"), EquityTracker(tmp_path / "eq.json"))


def ev(gate, now, order=None, account=None, market=None, open_positions=0):
    return gate.evaluate(
        order or make_order(), account or make_account(), market or make_market(now), now, open_positions
    )


def test_normal_small_order_allowed(gate, now):
    assert ev(gate, now).kind is VerdictKind.ALLOW


def test_order_above_approval_threshold_needs_approval(gate, now):
    assert ev(gate, now, order=make_order(lots=0.06)).kind is VerdictKind.NEEDS_APPROVAL


def test_order_at_threshold_does_not_need_approval(gate, now):
    assert ev(gate, now, order=make_order(lots=0.05)).kind is VerdictKind.ALLOW


def test_order_above_max_position_vetoed_not_clamped(gate, now):
    assert ev(gate, now, order=make_order(lots=0.11)).kind is VerdictKind.VETO


@pytest.mark.parametrize("lots", [0, -0.01])
def test_nonpositive_lots_vetoed(gate, now, lots):
    assert ev(gate, now, order=make_order(lots=lots)).kind is VerdictKind.VETO


def test_missing_stop_loss_vetoed(gate, now):
    assert ev(gate, now, order=make_order(sl=None)).kind is VerdictKind.VETO


def test_max_open_positions_vetoed(gate, now):
    assert ev(gate, now, open_positions=1).kind is VerdictKind.VETO


def test_stale_data_vetoed(gate, now):
    m = make_market(now, candle_age_s=3 * 300)
    assert ev(gate, now, market=m).kind is VerdictKind.VETO


def test_fresh_data_boundary_allowed(gate, now):
    m = make_market(now, candle_age_s=2 * 300)
    assert ev(gate, now, market=m).kind is VerdictKind.ALLOW


def test_wide_spread_vetoed(gate, now):
    m = make_market(now, bid=2000.0, ask=2000.61)  # 61 points
    assert ev(gate, now, market=m).kind is VerdictKind.VETO


def test_daily_loss_breach_vetoes_and_requests_trip(gate, now):
    ev(gate, now, account=make_account(10_000))  # sets day start
    v = ev(gate, now + timedelta(hours=1), account=make_account(9_790))  # -2.1%
    assert v.kind is VerdictKind.VETO and v.trip


def test_daily_loss_resets_next_day(gate, now):
    ev(gate, now, account=make_account(10_000))
    v = ev(gate, now + timedelta(days=1), account=make_account(9_790))
    assert v.kind is VerdictKind.ALLOW  # new day baseline = 9_790


def test_drawdown_breach_vetoes_and_requests_trip(gate, now):
    ev(gate, now, account=make_account(10_000))
    # recover day baseline each day, but peak stays 10_000
    d = now
    for i, eq in enumerate([9_800, 9_600, 9_400, 9_200, 9_000]):
        d = now + timedelta(days=i + 1)
        v = ev(gate, d, account=make_account(eq))
    assert v.kind is VerdictKind.VETO and v.trip  # 10% from peak


def test_killswitch_tripped_vetoes_everything(gate, now):
    gate.kill_switch.trip("manual", now)
    v = ev(gate, now)
    assert v.kind is VerdictKind.VETO and "kill" in v.reason.lower()


def test_killswitch_survives_restart(cfg, tmp_path, now):
    KillSwitch(tmp_path / "k.json").trip("dd", now)
    assert KillSwitch(tmp_path / "k.json").is_tripped


def test_killswitch_reset(tmp_path, now):
    k = KillSwitch(tmp_path / "k.json")
    k.trip("x", now)
    k.reset()
    assert not k.is_tripped


def test_equity_tracker_persists_across_restart(tmp_path, now):
    EquityTracker(tmp_path / "e.json").update(10_000, now)
    t = EquityTracker(tmp_path / "e.json")
    t.update(9_500, now + timedelta(hours=1))
    assert t.peak_equity == 10_000 and t.day_start_equity == 10_000


def test_approved_order_cannot_be_forged():
    with pytest.raises(PermissionError):
        ApprovedOrder(order=make_order(), _token=object())


def test_gate_mints_approved_order(gate):
    a = gate.mint(make_order())
    assert isinstance(a, ApprovedOrder)


@pytest.mark.parametrize("kw", [dict(sl=2005.0), dict(tp=1995.0)])
def test_buy_with_stops_on_wrong_side_vetoed(gate, now, kw):
    assert ev(gate, now, order=make_order(**kw)).kind is VerdictKind.VETO


@pytest.mark.parametrize("kw", [dict(sl=1995.0), dict(tp=2005.0)])
def test_sell_with_stops_on_wrong_side_vetoed(gate, now, kw):
    base = dict(side=__import__("xbot.models", fromlist=["Side"]).Side.SELL, sl=2010.0, tp=1990.0)
    assert ev(gate, now, order=make_order(**{**base, **kw})).kind is VerdictKind.VETO


def test_risk_per_trade_above_cap_vetoed(gate, now):
    # 0.05 lots, stop 40.2 away = $201 = 2.01% of 10k > 1%
    assert ev(gate, now, order=make_order(lots=0.05, sl=1960.0)).kind is VerdictKind.VETO


def test_risk_per_trade_within_cap_allowed(gate, now):
    # 0.02 lots, stop 10.2 away = $20.4 = 0.2%
    assert ev(gate, now, order=make_order(lots=0.02, sl=1990.0)).kind is VerdictKind.ALLOW
