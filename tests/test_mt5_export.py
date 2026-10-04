import gzip
import json
from datetime import datetime, timedelta, timezone

import pytest

from xbot.data import CsvSource
from xbot.mt5_export import (
    build_report,
    detect_server_offset,
    export,
    fetch_rates,
    find_symbol_candidates,
    is_us_dst,
    rates_to_candles,
    server_to_utc,
    symbol_info_dict,
    write_csv,
)


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def epoch_as_server(*a):
    """MT5 encodes server wall-clock time as if it were UTC epoch."""
    return int(utc(*a).timestamp())


def rate(t, c=2000.5, spread=20, v=100):
    return {"time": t, "open": 2000.0, "high": 2001.0, "low": 1999.0, "close": c,
            "tick_volume": v, "spread": spread, "real_volume": 0}


# ---- DST rule -------------------------------------------------------------
@pytest.mark.parametrize(
    "dt,expected",
    [
        (utc(2026, 3, 8, 6, 59), False), (utc(2026, 3, 8, 7, 0), True),
        (utc(2026, 11, 1, 5, 59), True), (utc(2026, 11, 1, 6, 0), False),
        (utc(2026, 1, 5), False), (utc(2026, 7, 6), True),
    ],
)
def test_us_dst_boundaries(dt, expected):
    assert is_us_dst(dt) is expected


def test_server_to_utc_winter_is_plus2():
    assert server_to_utc(epoch_as_server(2026, 1, 5, 14, 0)) == utc(2026, 1, 5, 12, 0)


def test_server_to_utc_summer_is_plus3():
    assert server_to_utc(epoch_as_server(2026, 7, 6, 15, 0)) == utc(2026, 7, 6, 12, 0)


def test_detect_server_offset_from_fresh_tick():
    now = utc(2026, 1, 5, 12, 0, 20)
    tick = epoch_as_server(2026, 1, 5, 14, 0, 0)
    assert detect_server_offset(tick, now) == timedelta(hours=2)


def test_detect_server_offset_stale_tick_is_none():
    assert detect_server_offset(epoch_as_server(2026, 1, 2, 23, 0), utc(2026, 1, 5, 12, 0)) is None


# ---- conversion -----------------------------------------------------------
def test_rates_to_candles_sorts_dedupes_and_converts():
    t1, t2 = epoch_as_server(2026, 1, 5, 14, 5), epoch_as_server(2026, 1, 5, 14, 0)
    cs = rates_to_candles([rate(t1), rate(t2), rate(t2)], 300)
    assert [c.ts for c in cs] == [utc(2026, 1, 5, 12, 0), utc(2026, 1, 5, 12, 5)]
    assert all(c.ts.tzinfo for c in cs)


def test_rates_to_candles_drops_invalid_bars():
    bad = rate(epoch_as_server(2026, 1, 5, 14, 0))
    bad["high"] = 1990.0  # high < low
    assert rates_to_candles([bad], 300) == []


# ---- fetching -------------------------------------------------------------
class FakeMt5:
    TIMEFRAME_M5 = 5
    TIMEFRAME_M1 = 1

    def __init__(self, rates):
        self.rates, self.calls, self.init_args = rates, [], None

    def initialize(self, *a, **k):
        self.init_args = (a, k)
        return True

    def last_error(self):
        return (0, "")

    def symbol_select(self, *a):
        return True

    def copy_rates_from_pos(self, sym, tf, pos, count):
        self.calls.append((pos, count))
        end = len(self.rates) - pos
        if end <= 0:
            return None
        return self.rates[max(0, end - count):end]


def series(n, start=(2026, 1, 5, 0, 0)):
    t0 = epoch_as_server(*start)
    return [rate(t0 + 300 * i, c=2000 + (i % 7) * 0.1) for i in range(n)]


def test_fetch_rates_spans_chunks_and_drops_forming_bar():
    rates = series(1000)
    fake = FakeMt5(rates)
    now_server_epoch = rates[-1]["time"] + 100  # last bar still forming
    out = fetch_rates(fake, "XAUUSD", 300, years=1.0, chunk=300, now_epoch=now_server_epoch)
    assert len(out) == 999
    assert [r["time"] for r in out] == sorted({r["time"] for r in out})
    assert len(fake.calls) >= 4


def test_fetch_rates_stops_at_cutoff():
    rates = series(5000)  # ~17 days
    fake = FakeMt5(rates)
    now = rates[-1]["time"] + 400
    out = fetch_rates(fake, "XAUUSD", 300, years=2 / 365, chunk=1000, now_epoch=now)  # 2 days
    span_days = (out[-1]["time"] - out[0]["time"]) / 86400
    assert 1.9 < span_days < 3.1


# ---- writing / round trip -------------------------------------------------
def test_csv_round_trip_through_csvsource(tmp_path):
    cs = rates_to_candles(series(50), 300)
    p = tmp_path / "x.csv"
    write_csv(cs, p)
    back = CsvSource(p, 300).closed_candles(utc(2030, 1, 1))
    assert [c.close for c in back] == [c.close for c in cs] and back[0].ts == cs[0].ts


def test_gzip_csv_round_trip(tmp_path):
    cs = rates_to_candles(series(50), 300)
    p = tmp_path / "x.csv.gz"
    write_csv(cs, p)
    assert gzip.open(p, "rt").readline().startswith("time,open")
    assert len(CsvSource(p, 300).closed_candles(utc(2030, 1, 1))) == 50


# ---- report ---------------------------------------------------------------
def test_report_spread_gaps_and_week_open():
    raw = series(100)
    # punch a 3h intraday hole
    raw = raw[:40] + raw[76:]
    for i, r in enumerate(raw):
        r["spread"] = 10 + (i % 10)
    cs = rates_to_candles(raw, 300)
    rep = build_report(cs, 300, [r["time"] for r in raw])
    assert rep["bars"] == len(raw)
    assert rep["spread_points"]["median"] == pytest.approx(14.5, abs=1)
    assert rep["spread_points"]["max"] == 19
    assert rep["gaps"]["small_le_4h"] == 1
    assert rep["first_bar_utc"] < rep["last_bar_utc"]


def test_week_open_signature_consistent_when_server_follows_dst():
    # three weeks, each opening Sunday 23:00 server time (winter + summer)
    opens = [epoch_as_server(2026, 1, 4, 23), epoch_as_server(2026, 7, 5, 23), epoch_as_server(2026, 12, 6, 23)]
    raw = []
    for o in opens:
        raw += [rate(o + 300 * i) for i in range(10)]
    rep = build_report(rates_to_candles(raw, 300), 300, [r["time"] for r in raw])
    assert rep["week_open_server_time"] == {"Sun 23:00": 3}
    assert rep["week_open_consistent"] is True


# ---- symbol info / orchestration -----------------------------------------
class Info:
    name = "XAUUSD"; digits = 2; point = 0.01; trade_contract_size = 100.0
    volume_min = 0.01; volume_step = 0.01; volume_max = 100.0
    trade_tick_value = 1.0; trade_tick_size = 0.01; trade_stops_level = 0
    spread = 18; currency_profit = "USD"; currency_base = "XAU"; swap_long = -20.0; swap_short = 5.0
    login = 12345  # must never be exported


def test_symbol_info_dict_has_costs_and_no_account_data():
    d = symbol_info_dict(Info())
    assert d["volume_step"] == 0.01 and d["trade_contract_size"] == 100.0
    assert "login" not in json.dumps(d)


def test_find_symbol_candidates():
    class M:
        def symbols_get(self):
            return [type("S", (), {"name": n}) for n in ("EURUSD", "XAUUSD.r", "GOLD", "XAGUSD")]
    assert find_symbol_candidates(M()) == ["XAUUSD.r", "GOLD"]


def test_export_writes_files_and_never_passes_credentials(tmp_path):
    rates = series(600)
    fake = FakeMt5(rates)
    fake.symbol_info = lambda s: Info()
    tick = type("T", (), {"time": epoch_as_server(2026, 1, 7, 2, 0, 5)})
    fake.symbol_info_tick = lambda s: tick
    out = export(fake, "XAUUSD", ["M5"], years=1.0, outdir=tmp_path, gzip_output=False,
                 now_utc=utc(2026, 1, 7, 0, 0))
    assert out["server_offset_detected_hours"] == 2.0 and out["offset_rule_matches_detected"] is True
    assert out["timeframes"]["M5"]["bars"] == 600
    assert fake.init_args == ((), {})
    assert (tmp_path / "XAUUSD_M5.csv").exists()
    info = json.loads((tmp_path / "symbol_info.json").read_text())
    rep = json.loads((tmp_path / "export_report.json").read_text())
    assert info["name"] == "XAUUSD" and "M5" in rep["timeframes"]
    assert "login" not in (tmp_path / "export_report.json").read_text()
