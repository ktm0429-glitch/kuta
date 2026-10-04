"""Training labels. The label for bar i uses ONLY bars i+1 .. i+horizon (and the snapshot at i).

Trades are simulated like the backtest engine: entry at the next bar's open (long at the ask,
short at the bid), stop checked before target within a bar, bars are bid-based (short exits add the spread).
Bars without a full horizon ahead get no label (None), so training never sees a partial outcome.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .models import Candle
from .state import Snapshot

POINT = 0.01


@dataclass(frozen=True)
class LabelSpec:
    horizon: int
    stop_vol_mult: float
    r_multiple: float
    min_stop_points: float
    move_vol_mult: float = 1.0

    @classmethod
    def from_rules(cls, rules, move_vol_mult: float = 1.0) -> "LabelSpec":
        s = rules.stops
        return cls(s.horizon_candles, s.stop_vol_mult, s.r_multiple, s.min_stop_points, move_vol_mult)


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


def _long_wins(bars: list[Candle], dist: float, r: float) -> int:
    entry = bars[0].open + bars[0].spread_points * POINT
    stop, tp = entry - dist, entry + r * dist
    for b in bars:
        if b.low <= stop:
            return 0
        if b.high >= tp:
            return 1
    return 0


def _short_wins(bars: list[Candle], dist: float, r: float) -> int:
    entry = bars[0].open
    stop, tp = entry + dist, entry - r * dist
    for b in bars:
        sp = b.spread_points * POINT
        if b.high + sp >= stop:
            return 0
        if b.low + sp <= tp:
            return 1
    return 0


def build_labels(candles: list[Candle], snaps: list[Snapshot | None], spec: LabelSpec) -> list[dict | None]:
    n, h = len(candles), spec.horizon
    out: list[dict | None] = [None] * n
    for i in range(n):
        s = snaps[i]
        if s is None or i + h >= n:
            continue
        scale = s.realized_vol * s.price * math.sqrt(h)
        fwd = candles[i + h].close - candles[i].close
        thr = spec.move_vol_mult * scale
        direction = 0 if fwd > thr else 1 if fwd < -thr else 2  # up, down, none (DIRECTIONS order)
        pressure = None
        if s.flow != 0:
            pressure = int(_sign(fwd) == _sign(s.flow) and abs(fwd) > 0.5 * scale)
        dist = max(spec.stop_vol_mult * s.realized_vol * s.price, spec.min_stop_points * POINT)
        window = candles[i + 1: i + h + 1]
        out[i] = {
            "direction": direction,
            "pressure": pressure,
            "quality_up": _long_wins(window, dist, spec.r_multiple),
            "quality_down": _short_wins(window, dist, spec.r_multiple),
        }
    return out
