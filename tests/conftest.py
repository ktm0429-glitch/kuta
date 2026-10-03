from datetime import datetime, timedelta, timezone

import pytest

from xbot.config import load_risk_config
from xbot.models import AccountState, MarketState, OrderRequest, Side

T0 = datetime(2026, 1, 5, 12, 0, tzinfo=timezone.utc)


@pytest.fixture
def cfg():
    return load_risk_config("config/risk.yaml")


@pytest.fixture
def now():
    return T0


def make_market(ts=T0, bid=2000.00, ask=2000.20, candle_age_s=10):
    return MarketState(ts=ts, bid=bid, ask=ask, last_candle_ts=ts - timedelta(seconds=candle_age_s))


def make_order(lots=0.02, side=Side.BUY, sl=1995.0, tp=2010.0):
    return OrderRequest(side=side, lots=lots, sl=sl, tp=tp, reason="test")


def make_account(equity=10_000.0, balance=None):
    return AccountState(balance=equity if balance is None else balance, equity=equity)
