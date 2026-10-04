import math
from datetime import datetime, timedelta, timezone

import pytest

from xbot.data import CsvSource, DataError, Mt5Source

HEADER = "time,open,high,low,close,tick_volume,spread\n"


def write(tmp_path, rows, header=HEADER):
    p = tmp_path / "c.csv"
    p.write_text(header + "".join(rows))
    return p


def row(minute, o=2000.0, h=2001.0, l=1999.0, c=2000.5, v=100, s=20, hour=12):
    return f"2026-01-05T{hour:02d}:{minute:02d}:00+00:00,{o},{h},{l},{c},{v},{s}\n"


def utc(h, m, s=0):
    return datetime(2026, 1, 5, h, m, s, tzinfo=timezone.utc)


def test_parses_candles(tmp_path):
    src = CsvSource(write(tmp_path, [row(0), row(5)]), timeframe_seconds=300)
    cs = src.closed_candles(utc(13, 0))
    assert len(cs) == 2 and cs[0].ts == utc(12, 0) and cs[0].close == 2000.5


def test_only_closed_candles_returned(tmp_path):
    src = CsvSource(write(tmp_path, [row(0), row(5)]), timeframe_seconds=300)
    assert [c.ts for c in src.closed_candles(utc(12, 4, 59))] == []
    assert [c.ts for c in src.closed_candles(utc(12, 5, 0))] == [utc(12, 0)]
    assert [c.ts for c in src.closed_candles(utc(12, 9, 59))] == [utc(12, 0)]
    assert len(src.closed_candles(utc(12, 10, 0))) == 2


def test_close_ts(tmp_path):
    c = CsvSource(write(tmp_path, [row(0)]), 300).closed_candles(utc(13, 0))[0]
    assert c.close_ts == utc(12, 5)


@pytest.mark.parametrize(
    "rows",
    [
        [row(5), row(0)],  # out of order
        [row(0), row(0)],  # duplicate
        ["2026-01-05T12:00:00,1,2,0.5,1.5,10,5\n"],  # naive timestamp
        [row(0, h=1990.0, l=1999.0)],  # high < low
        [row(0, o=-1)],  # negative price
        [row(0, c=float("nan"))],  # NaN
        [row(0, v=-5)],  # negative volume
    ],
)
def test_rejects_bad_data(tmp_path, rows):
    with pytest.raises(DataError):
        CsvSource(write(tmp_path, rows), 300)


def test_rejects_missing_columns(tmp_path):
    with pytest.raises(DataError):
        CsvSource(write(tmp_path, ["2026-01-05T12:00:00+00:00,1,2,0.5,1.5\n"], "time,open,high,low,close\n"), 300)


# ---- MT5 source (fake module; real one is Windows-only) -------------------
class FakeMt5:
    TIMEFRAME_M5 = 5

    def __init__(self, rates, ok=True):
        self.rates, self.ok, self.init_args = rates, ok, None

    def initialize(self, *a, **kw):
        self.init_args = (a, kw)
        return self.ok

    def last_error(self):
        return (1, "boom")

    def symbol_select(self, *a):
        return True

    def copy_rates_from_pos(self, symbol, tf, pos, count):
        return self.rates[-count:]


def epoch(h, m):
    return int(utc(h, m).timestamp())


def rate(h, m, c=2000.5):
    return {"time": epoch(h, m), "open": 2000.0, "high": 2001.0, "low": 1999.0,
            "close": c, "tick_volume": 100, "spread": 20, "real_volume": 0}


def test_mt5_drops_forming_candle():
    # last bar (12:10) is still forming at 12:12
    fake = FakeMt5([rate(12, 0), rate(12, 5), rate(12, 10)])
    src = Mt5Source(fake, "XAUUSD", 300, now_fn=lambda: utc(12, 12))
    assert [c.ts for c in src.closed_candles(utc(12, 12), count=10)] == [utc(12, 0), utc(12, 5)]


def test_mt5_times_are_utc_aware():
    fake = FakeMt5([rate(12, 0)])
    c = Mt5Source(fake, "XAUUSD", 300, now_fn=lambda: utc(13, 0)).closed_candles(utc(13, 0), count=1)[0]
    assert c.ts.tzinfo is not None and c.ts == utc(12, 0)


def test_mt5_initialize_never_receives_credentials():
    fake = FakeMt5([rate(12, 0)])
    Mt5Source(fake, "XAUUSD", 300, now_fn=lambda: utc(13, 0))
    assert fake.init_args == ((), {})


def test_mt5_init_failure_raises():
    with pytest.raises(DataError):
        Mt5Source(FakeMt5([], ok=False), "XAUUSD", 300)


def test_mt5_server_offset_applied():
    fake = FakeMt5([rate(14, 0)])  # server clock shows 14:00 = 12:00 UTC (UTC+2)
    src = Mt5Source(fake, "XAUUSD", 300, server_offset=timedelta(hours=2), now_fn=lambda: utc(13, 0))
    assert src.closed_candles(utc(13, 0), count=1)[0].ts == utc(12, 0)
