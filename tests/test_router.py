from datetime import timedelta

import pytest

from conftest import T0, make_market, make_order
from xbot.broker import SimBroker
from xbot.journal import Journal
from xbot.risk import EquityTracker, KillSwitch, RiskGate
from xbot.router import OrderRouter, Status


class FakeNotifier:
    def __init__(self):
        self.msgs = []

    def send(self, text):
        self.msgs.append(text)


class FlakyBroker(SimBroker):
    fail = True

    def send(self, approved):
        if self.fail:
            raise ConnectionError("mt5 down")
        return super().send(approved)


@pytest.fixture
def env(cfg, tmp_path):
    broker = SimBroker(balance=10_000.0, slippage_points=0)
    broker.set_market(make_market(T0))
    gate = RiskGate(cfg, KillSwitch(tmp_path / "k.json"), EquityTracker(tmp_path / "e.json"))
    notifier = FakeNotifier()
    journal = Journal(tmp_path / "j.sqlite")
    router = OrderRouter(broker, gate, journal, notifier, cfg, approval_timeout_s=300)
    return router, broker, gate, notifier, journal


def test_allowed_order_fills_and_is_journaled(env):
    router, broker, *_rest, journal = env
    r = router.submit(make_order(), T0)
    assert r.status is Status.FILLED and len(broker.positions()) == 1
    assert journal.events("fill")


def test_vetoed_order_never_reaches_broker(env):
    router, broker, *_ = env
    r = router.submit(make_order(lots=0.5), T0)
    assert r.status is Status.VETOED and broker.positions() == []


def test_large_order_waits_for_approval_then_fills(env):
    router, broker, *_ = env
    r = router.submit(make_order(lots=0.06), T0)
    assert r.status is Status.PENDING and broker.positions() == []
    r2 = router.confirm(r.pending_id, T0 + timedelta(seconds=60))
    assert r2.status is Status.FILLED and len(broker.positions()) == 1


def test_pending_order_expires(env):
    router, broker, *_ = env
    r = router.submit(make_order(lots=0.06), T0)
    r2 = router.confirm(r.pending_id, T0 + timedelta(seconds=301))
    assert r2.status is Status.EXPIRED and broker.positions() == []


def test_pending_order_can_be_denied(env):
    router, broker, *_ = env
    r = router.submit(make_order(lots=0.06), T0)
    assert router.deny(r.pending_id, T0).status is Status.DENIED
    assert router.confirm(r.pending_id, T0).status is Status.UNKNOWN


def test_confirm_rechecks_risk(env):
    router, broker, gate, *_ = env
    r = router.submit(make_order(lots=0.06), T0)
    gate.kill_switch.trip("manual", T0)
    assert router.confirm(r.pending_id, T0).status is Status.VETOED


def test_trip_flattens_halts_and_notifies(env):
    router, broker, gate, notifier, journal = env
    router.submit(make_order(), T0)
    router.trip("test", T0)
    assert broker.positions() == []
    assert gate.kill_switch.is_tripped
    assert any("kill" in m.lower() for m in notifier.msgs)
    assert router.submit(make_order(), T0).status is Status.VETOED


def test_daily_loss_breach_trips_kill_switch_via_tick(env):
    router, broker, gate, notifier, _ = env
    router.tick(T0)  # baseline
    broker.set_balance(9_700.0)  # -3%
    router.tick(T0 + timedelta(hours=1))
    assert gate.kill_switch.is_tripped


def test_three_consecutive_broker_errors_trip(cfg, tmp_path):
    broker = FlakyBroker(balance=10_000.0, slippage_points=0)
    broker.set_market(make_market(T0))
    gate = RiskGate(cfg, KillSwitch(tmp_path / "k.json"), EquityTracker(tmp_path / "e.json"))
    n = FakeNotifier()
    router = OrderRouter(broker, gate, Journal(tmp_path / "j.sqlite"), n, cfg)
    for _ in range(3):
        assert router.submit(make_order(), T0).status is Status.ERROR
    assert gate.kill_switch.is_tripped


def test_success_resets_error_counter(cfg, tmp_path):
    broker = FlakyBroker(balance=10_000.0, slippage_points=0)
    broker.set_market(make_market(T0))
    gate = RiskGate(cfg, KillSwitch(tmp_path / "k.json"), EquityTracker(tmp_path / "e.json"))
    router = OrderRouter(broker, gate, Journal(tmp_path / "j.sqlite"), FakeNotifier(), cfg)
    router.submit(make_order(), T0)
    router.submit(make_order(), T0)
    broker.fail = False
    assert router.submit(make_order(), T0).status is Status.FILLED
    broker.fail = True
    broker.flatten_all(T0)
    router.submit(make_order(), T0)
    assert not gate.kill_switch.is_tripped


def test_fill_notifies(env):
    router, _, _, notifier, _ = env
    router.submit(make_order(), T0)
    assert any("fill" in m.lower() for m in notifier.msgs)
