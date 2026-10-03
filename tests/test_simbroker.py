import pytest

from conftest import T0, make_market, make_order
from xbot.broker import SimBroker
from xbot.models import Side
from xbot.risk import ApprovedOrder


@pytest.fixture
def broker():
    b = SimBroker(balance=10_000.0, slippage_points=0)
    b.set_market(make_market(T0, bid=2000.00, ask=2000.20))
    return b


def approved(order):
    from xbot.risk import RiskGate
    return RiskGate.mint(order)


def test_rejects_unapproved_order(broker):
    with pytest.raises(TypeError):
        broker.send(make_order())


def test_buy_fills_at_ask_and_opens_position(broker):
    f = broker.send(approved(make_order(lots=0.02)))
    assert f.price == 2000.20
    assert len(broker.positions()) == 1


def test_sell_fills_at_bid(broker):
    f = broker.send(approved(make_order(side=Side.SELL, sl=2005, tp=1990)))
    assert f.price == 2000.00


def test_slippage_worsens_fill():
    b = SimBroker(balance=10_000.0, slippage_points=10)
    b.set_market(make_market(T0, bid=2000.00, ask=2000.20))
    assert b.send(approved(make_order())).price == pytest.approx(2000.30)


def test_equity_marks_to_market(broker):
    broker.send(approved(make_order(lots=1.0)))  # buy 1 lot @2000.20
    broker.set_market(make_market(T0, bid=2001.20, ask=2001.40))
    # 100 oz * (2001.20 - 2000.20) = 100
    assert broker.account().equity == pytest.approx(10_100.0)


def test_flatten_all_realizes_pnl_and_closes(broker):
    broker.send(approved(make_order(lots=1.0)))
    broker.set_market(make_market(T0, bid=2001.20, ask=2001.40))
    broker.flatten_all(T0)
    assert broker.positions() == []
    assert broker.account().balance == pytest.approx(10_100.0)


def test_stop_loss_triggers_on_market_move(broker):
    broker.send(approved(make_order(lots=1.0, sl=1995.0, tp=2010.0)))
    broker.set_market(make_market(T0, bid=1994.9, ask=1995.1))
    assert broker.positions() == []
    assert broker.account().balance < 10_000.0
