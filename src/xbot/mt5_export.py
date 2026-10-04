"""Export MT5 history to CSV for backtesting (run on the Windows EA PC).

Attaches to the already logged-in terminal (initialize() with no credentials)
and never reads or writes account data (login, balance, server...).

MT5 bar times are SERVER wall-clock time encoded as epoch. TitanFX-style
servers follow GMT+2 in winter and GMT+3 while US DST is in effect; this module
applies that rule and records whether the data is consistent with it.
"""
from __future__ import annotations

import collections
import gzip
import json
import statistics
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .data import DataError, _validate
from .models import Candle

SYMBOL_INFO_FIELDS = (
    "name", "digits", "point", "trade_contract_size", "volume_min", "volume_step",
    "volume_max", "trade_tick_value", "trade_tick_size", "trade_stops_level",
    "spread", "currency_base", "currency_profit", "swap_long", "swap_short",
)


class ExportError(Exception):
    pass


# --- time handling ---------------------------------------------------------
def _nth_sunday(year: int, month: int, n: int) -> datetime:
    d = datetime(year, month, 1, tzinfo=timezone.utc)
    first_sunday = d + timedelta(days=(6 - d.weekday()) % 7)
    return first_sunday + timedelta(weeks=n - 1)


def is_us_dst(utc_dt: datetime) -> bool:
    """US DST: from 2nd Sunday of March 07:00 UTC to 1st Sunday of Nov 06:00 UTC."""
    y = utc_dt.year
    start = _nth_sunday(y, 3, 2).replace(hour=7)
    end = _nth_sunday(y, 11, 1).replace(hour=6)
    return start <= utc_dt < end


def server_to_utc(server_epoch: int) -> datetime:
    naive = datetime.fromtimestamp(int(server_epoch), tz=timezone.utc)  # server wall clock
    summer = naive - timedelta(hours=3)
    return summer if is_us_dst(summer) else naive - timedelta(hours=2)


def rule_offset(utc_dt: datetime) -> timedelta:
    return timedelta(hours=3 if is_us_dst(utc_dt) else 2)


def detect_server_offset(tick_server_epoch: int, now_utc: datetime) -> timedelta | None:
    """Offset (server - UTC) from a fresh tick; None if the tick is stale (e.g. weekend)."""
    server = datetime.fromtimestamp(int(tick_server_epoch), tz=timezone.utc)
    diff = (server - now_utc).total_seconds()
    rounded = round(diff / 1800) * 1800
    if abs(diff - rounded) > 600 or abs(rounded) > 14 * 3600:
        return None
    return timedelta(seconds=rounded)


# --- conversion ------------------------------------------------------------
def rates_to_candles(rates, tf_seconds: int, stats: dict | None = None) -> list[Candle]:
    stats = stats if stats is not None else {}
    by_time: dict[int, Candle] = {}
    for r in rates:
        t = int(r["time"])
        if t in by_time:
            stats["duplicates"] = stats.get("duplicates", 0) + 1
            continue
        c = Candle(server_to_utc(t), float(r["open"]), float(r["high"]), float(r["low"]),
                   float(r["close"]), float(r["tick_volume"]), float(r["spread"]), tf_seconds)
        try:
            _validate(c, f"bar {t}")
        except DataError:
            stats["dropped_invalid"] = stats.get("dropped_invalid", 0) + 1
            continue
        by_time[t] = c
    return sorted(by_time.values(), key=lambda c: c.ts)


def _tf_const_name(tf_seconds: int) -> str:
    return f"TIMEFRAME_M{tf_seconds // 60}" if tf_seconds < 3600 else f"TIMEFRAME_H{tf_seconds // 3600}"


def parse_timeframe(name: str) -> int:
    unit = {"M": 60, "H": 3600}[name[0].upper()]
    return int(name[1:]) * unit


def fetch_rates(mt5, symbol: str, tf_seconds: int, years: float, chunk: int = 50_000,
                now_epoch: int | None = None) -> list:
    """Pull bars backwards in chunks until `years` of history or the broker's limit."""
    tf_const = getattr(mt5, _tf_const_name(tf_seconds))
    now_epoch = now_epoch if now_epoch is not None else int(datetime.now(timezone.utc).timestamp())
    cutoff = now_epoch - int(years * 365.25 * 86400)
    got, pos = [], 0
    while True:
        r = mt5.copy_rates_from_pos(symbol, tf_const, pos, chunk)
        if r is None or len(r) == 0:
            break
        got.extend(r)
        pos += len(r)
        if int(r[0]["time"]) < cutoff or len(r) < chunk:
            break
    uniq = {int(x["time"]): x for x in got}
    return [uniq[t] for t in sorted(uniq) if t >= cutoff and t + tf_seconds <= now_epoch]


# --- output ----------------------------------------------------------------
def write_csv(candles: list[Candle], path: str | Path) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    opener = gzip.open(path, "wt", newline="") if path.suffix == ".gz" else open(path, "w", newline="")
    with opener as f:
        f.write("time,open,high,low,close,tick_volume,spread\n")
        for c in candles:
            f.write(f"{c.ts.isoformat()},{c.open!r},{c.high!r},{c.low!r},{c.close!r},"
                    f"{c.tick_volume!r},{c.spread_points!r}\n")


def symbol_info_dict(info) -> dict:
    return {k: getattr(info, k, None) for k in SYMBOL_INFO_FIELDS}


def find_symbol_candidates(mt5) -> list[str]:
    names = [s.name for s in (mt5.symbols_get() or [])]
    return [n for n in names if "XAU" in n.upper() or "GOLD" in n.upper()]


def build_report(candles: list[Candle], tf_seconds: int, raw_server_times: list[int]) -> dict:
    spreads = [c.spread_points for c in candles]
    gaps = collections.Counter()
    examples = []
    for a, b in zip(candles, candles[1:]):
        gap = (b.ts - a.ts).total_seconds()
        if gap <= tf_seconds:
            continue
        h = gap / 3600
        key = "small_le_4h" if h <= 4 else "mid_4h_40h" if h <= 40 else "weekend_40h_80h" if h <= 80 else "long_gt_80h"
        gaps[key] += 1
        if key in ("mid_4h_40h", "long_gt_80h") and len(examples) < 20:
            examples.append({"from": a.ts.isoformat(), "to": b.ts.isoformat(), "hours": round(h, 1)})

    # first bar of each trading week in SERVER time: constant => server follows a fixed (DST-aware) clock
    weeks: dict[tuple, int] = {}
    for t in sorted(raw_server_times):
        d = datetime.fromtimestamp(t, tz=timezone.utc)
        key = (d + timedelta(days=1)).isocalendar()[:2]  # Sunday opens belong to the next week
        weeks.setdefault(key, t)
    sig = collections.Counter(
        datetime.fromtimestamp(t, tz=timezone.utc).strftime("%a %H:%M") for t in weeks.values()
    )
    top = sig.most_common(1)[0][1] if sig else 0
    return {
        "bars": len(candles),
        "first_bar_utc": candles[0].ts.isoformat() if candles else None,
        "last_bar_utc": candles[-1].ts.isoformat() if candles else None,
        "spread_points": {
            "median": statistics.median(spreads) if spreads else None,
            "mean": round(statistics.fmean(spreads), 2) if spreads else None,
            "p95": sorted(spreads)[int(0.95 * (len(spreads) - 1))] if spreads else None,
            "max": max(spreads) if spreads else None,
        },
        "gaps": {k: gaps.get(k, 0) for k in ("small_le_4h", "mid_4h_40h", "weekend_40h_80h", "long_gt_80h")},
        "gap_examples": examples,
        "week_open_server_time": dict(sig),
        "week_open_consistent": bool(sig) and top / sum(sig.values()) >= 0.9,
    }


# --- orchestration ----------------------------------------------------------
def export(mt5, symbol: str, timeframes: list[str], years: float, outdir: str | Path,
           gzip_output: bool = True, now_utc: datetime | None = None) -> dict:
    now_utc = now_utc or datetime.now(timezone.utc)
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    if not mt5.initialize():  # attaches to the logged-in terminal; NO credentials
        raise ExportError(f"MT5 initialize failed: {mt5.last_error()}. Open MT5 and log in first.")
    info = mt5.symbol_info(symbol)
    if info is None:
        raise ExportError(f"Symbol {symbol!r} not found. Candidates: {find_symbol_candidates(mt5)}")
    mt5.symbol_select(symbol, True)

    tick = mt5.symbol_info_tick(symbol)
    detected = detect_server_offset(tick.time, now_utc) if tick else None
    expected = rule_offset(now_utc)
    now_server_epoch = int((now_utc + (detected or expected)).timestamp())

    (outdir / "symbol_info.json").write_text(json.dumps(symbol_info_dict(info), indent=2))
    report = {
        "symbol": symbol,
        "exported_at_utc": now_utc.isoformat(),
        "server_offset_detected_hours": detected.total_seconds() / 3600 if detected else None,
        "server_offset_rule_hours": expected.total_seconds() / 3600,
        "offset_rule_matches_detected": (detected == expected) if detected else None,
        "timeframes": {},
    }
    for name in timeframes:
        tf = parse_timeframe(name)
        rates = fetch_rates(mt5, symbol, tf, years, now_epoch=now_server_epoch)
        stats: dict = {}
        candles = rates_to_candles(rates, tf, stats)
        path = outdir / f"{symbol}_{name}.csv{'.gz' if gzip_output else ''}"
        write_csv(candles, path)
        rep = build_report(candles, tf, [int(r["time"]) for r in rates])
        rep.update(stats)
        rep["file"] = path.name
        rep["requested_years"] = years
        report["timeframes"][name] = rep
    (outdir / "export_report.json").write_text(json.dumps(report, indent=2))
    return report
