"""Candle sources. Both return ONLY closed candles (close_ts <= decision time)."""
from __future__ import annotations

import bisect
import csv
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Protocol

from .models import Candle

REQUIRED = ("time", "open", "high", "low", "close", "tick_volume", "spread")


class DataError(Exception):
    pass


class CandleSource(Protocol):
    def closed_candles(self, until: datetime, count: int | None = None) -> list[Candle]: ...


def _validate(c: Candle, where: str) -> None:
    vals = (c.open, c.high, c.low, c.close, c.tick_volume, c.spread_points)
    if not all(math.isfinite(v) for v in vals):
        raise DataError(f"{where}: non-finite value")
    if min(c.open, c.high, c.low, c.close) <= 0 or c.tick_volume < 0 or c.spread_points < 0:
        raise DataError(f"{where}: non-positive price or negative volume/spread")
    if c.high < c.low or not (c.low <= c.open <= c.high) or not (c.low <= c.close <= c.high):
        raise DataError(f"{where}: inconsistent OHLC")


class CsvSource:
    """Reads an MT5 export: time(ISO8601 UTC offset required),open,high,low,close,tick_volume,spread."""

    def __init__(self, path: str | Path, timeframe_seconds: int):
        self._candles: list[Candle] = []
        with open(path, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            if reader.fieldnames is None or any(col not in reader.fieldnames for col in REQUIRED):
                raise DataError(f"CSV must have columns {REQUIRED}")
            for n, r in enumerate(reader, start=2):
                where = f"line {n}"
                try:
                    ts = datetime.fromisoformat(r["time"])
                    c = Candle(
                        ts=ts.astimezone(timezone.utc) if ts.tzinfo else ts,
                        open=float(r["open"]), high=float(r["high"]), low=float(r["low"]),
                        close=float(r["close"]), tick_volume=float(r["tick_volume"]),
                        spread_points=float(r["spread"]), duration_s=timeframe_seconds,
                    )
                except (ValueError, TypeError) as e:
                    raise DataError(f"{where}: {e}") from e
                if c.ts.tzinfo is None:
                    raise DataError(f"{where}: timestamp must include a UTC offset")
                _validate(c, where)
                if self._candles and c.ts <= self._candles[-1].ts:
                    raise DataError(f"{where}: timestamps must be strictly increasing")
                self._candles.append(c)
        # strictly increasing open times => close times are sorted too
        self._close_ts = [c.close_ts for c in self._candles]

    def closed_candles(self, until: datetime, count: int | None = None) -> list[Candle]:
        hi = bisect.bisect_right(self._close_ts, until)
        lo = max(0, hi - count) if count else 0
        return self._candles[lo:hi]


class Mt5Source:
    """Live source over the MetaTrader5 module (Windows only; module is injected).

    Attaches to the already logged-in terminal: initialize() gets NO credentials.
    MT5 bar times are broker SERVER time encoded as epoch; pass server_offset
    (server - UTC, e.g. timedelta(hours=2)) once measured in M3.
    """

    def __init__(
        self,
        mt5,
        symbol: str,
        timeframe_seconds: int,
        server_offset: timedelta = timedelta(0),
        now_fn: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    ):
        if not mt5.initialize():
            raise DataError(f"MT5 initialize failed: {mt5.last_error()}")
        if timeframe_seconds % 60:
            raise DataError("timeframe must be whole minutes")
        self._mt5, self._symbol, self._tf = mt5, symbol, timeframe_seconds
        self._tf_const = getattr(mt5, f"TIMEFRAME_M{timeframe_seconds // 60}")
        self._offset, self._now = server_offset, now_fn
        mt5.symbol_select(symbol, True)

    def closed_candles(self, until: datetime, count: int | None = 500) -> list[Candle]:
        n = count or 500
        rates = self._mt5.copy_rates_from_pos(self._symbol, self._tf_const, 0, n + 1)
        if rates is None:
            raise DataError(f"MT5 returned no rates: {self._mt5.last_error()}")
        limit = min(until, self._now())
        out = []
        for r in rates:
            ts = datetime.fromtimestamp(int(r["time"]), tz=timezone.utc) - self._offset
            c = Candle(ts, float(r["open"]), float(r["high"]), float(r["low"]), float(r["close"]),
                       float(r["tick_volume"]), float(r["spread"]), self._tf)
            if c.close_ts <= limit:
                _validate(c, f"mt5 bar {ts}")
                out.append(c)
        return out[-n:]
