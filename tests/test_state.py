import math
import random
from datetime import datetime, timedelta, timezone

import pytest

from xbot.data import CsvSource
from xbot.models import Candle
from xbot.state import FEATURES, LookaheadError, StateEngine

T0 = datetime(2026, 1, 5, 0, 0, tzinfo=timezone.utc)
TF = 300


def candle(i, o, h, l, c, v=100, s=20):
    return Candle(ts=T0 + timedelta(seconds=TF * i), open=o, high=h, low=l, close=c,
                  tick_volume=v, spread_points=s, duration_s=TF)


def walk(n, seed=1):
    rnd, px, out = random.Random(seed), 2000.0, []
    for i in range(n):
        o = px
        c = o + rnd.uniform(-1.5, 1.5)
        h, l = max(o, c) + rnd.uniform(0, 0.5), min(o, c) - rnd.uniform(0, 0.5)
        out.append(candle(i, o, h, l, c, v=rnd.randint(50, 300), s=rnd.randint(15, 30)))
        px = c
    return out


def at(candles, k):
    """decision time = close of candle k-1 (i.e. open of candle k)"""
    return candles[k - 1].close_ts


def test_insufficient_history_returns_none():
    eng = StateEngine()
    cs = walk(eng.min_candles - 1)
    assert eng.snapshot(cs, at(cs, len(cs))) is None


def test_snapshot_has_all_numeric_finite_features():
    eng, cs = StateEngine(), walk(60)
    snap = eng.snapshot(cs, at(cs, 60))
    vec = snap.as_vector()
    assert len(vec) == len(FEATURES) and all(math.isfinite(x) for x in vec)


def test_lookahead_is_rejected():
    eng, cs = StateEngine(), walk(60)
    with pytest.raises(LookaheadError):
        eng.snapshot(cs, cs[-1].ts)  # last candle not closed yet at its open time


def test_deterministic():
    eng, cs = StateEngine(), walk(60)
    t = at(cs, 60)
    assert eng.snapshot(cs, t) == eng.snapshot(list(cs), t)


@pytest.mark.parametrize("k", [30, 45, 70, 99])
def test_future_data_cannot_change_snapshot(tmp_path, k):
    """Property: snapshot at decision time t is identical whether or not the
    data source also contains candles after t."""
    eng, cs = StateEngine(), walk(120, seed=k)
    full, trunc = tmp_path / "full.csv", tmp_path / "trunc.csv"
    hdr = "time,open,high,low,close,tick_volume,spread\n"
    fmt = lambda c: f"{c.ts.isoformat()},{c.open},{c.high},{c.low},{c.close},{c.tick_volume},{c.spread_points}\n"
    full.write_text(hdr + "".join(fmt(c) for c in cs))
    trunc.write_text(hdr + "".join(fmt(c) for c in cs[:k]))
    t = at(cs, k)
    a = eng.snapshot_at(CsvSource(full, TF), t)
    b = eng.snapshot_at(CsvSource(trunc, TF), t)
    assert a == b and a is not None


def test_mid_candle_decision_time_ignores_forming_candle():
    eng, cs = StateEngine(), walk(60)
    t_mid = cs[40].ts + timedelta(seconds=100)  # candle 40 is forming
    s = eng.snapshot(cs[:40], t_mid)  # only closed candles passed
    assert s is not None and s.price == cs[39].close
    with pytest.raises(LookaheadError):
        eng.snapshot(cs[:41], t_mid)


def test_flat_market_has_zero_vol_trend_and_flow():
    eng = StateEngine()
    cs = [candle(i, 2000, 2000, 2000, 2000) for i in range(60)]
    s = eng.snapshot(cs, at(cs, 60))
    assert s.realized_vol == 0 and s.trend == 0 and s.flow == 0 and s.imbalance == 0


def test_uptrend_signs():
    eng = StateEngine()
    cs = [candle(i, 2000 + i, 2001 + i, 1999.9 + i, 2000.95 + i) for i in range(60)]
    s = eng.snapshot(cs, at(cs, 60))
    assert s.trend > 0 and s.flow > 0 and s.imbalance > 0 and s.realized_vol > 0


def test_downtrend_signs():
    eng = StateEngine()
    cs = [candle(i, 2000 - i, 2000.1 - i, 1999 - i, 1999.05 - i) for i in range(60)]
    s = eng.snapshot(cs, at(cs, 60))
    assert s.trend < 0 and s.flow < 0 and s.imbalance < 0


def test_spread_and_price_come_from_last_closed_candle():
    eng, cs = StateEngine(), walk(60)
    s = eng.snapshot(cs, at(cs, 60))
    assert s.spread_points == cs[-1].spread_points and s.price == cs[-1].close
