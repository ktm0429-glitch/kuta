"""Deterministic state engine: packs the market into one compact numeric snapshot.

Only information from candles CLOSED at or before the decision time is used.
Order-book imbalance is not available for XAUUSD at FX brokers, so two proxies
are used instead: close-location-value (imbalance) and signed tick volume (flow).
"""
from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from datetime import datetime

from .data import CandleSource
from .models import Candle

FEATURES = ("price", "spread_points", "imbalance", "realized_vol", "trend", "flow")

VOL_N, TREND_N, IMB_N, FLOW_N = 20, 20, 10, 5


class LookaheadError(Exception):
    pass


@dataclass(frozen=True)
class Snapshot:
    ts: datetime
    price: float
    spread_points: float
    imbalance: float      # volume-weighted close location value, [-1, 1]
    realized_vol: float   # stdev of per-candle log returns
    trend: float          # OLS slope of closes per candle, as fraction of price
    flow: float           # signed tick-volume ratio over recent candles, [-1, 1]

    def as_vector(self) -> tuple[float, ...]:
        return tuple(getattr(self, f) for f in FEATURES)


def _clv(c: Candle) -> float:
    rng = c.high - c.low
    return 0.0 if rng <= 0 else ((c.close - c.low) - (c.high - c.close)) / rng


def _sign(x: float) -> int:
    return (x > 0) - (x < 0)


def _weighted(vals: list[float], weights: list[float]) -> float:
    tot = sum(weights)
    return 0.0 if tot <= 0 else sum(v * w for v, w in zip(vals, weights)) / tot


class StateEngine:
    min_candles = max(VOL_N + 1, TREND_N, IMB_N, FLOW_N)

    def snapshot(self, candles: list[Candle], decision_ts: datetime) -> Snapshot | None:
        for c in candles:
            if c.close_ts > decision_ts:
                raise LookaheadError(f"candle {c.ts} closes at {c.close_ts} > decision {decision_ts}")
        if len(candles) < self.min_candles:
            return None
        last = candles[-1]
        closes = [c.close for c in candles[-(VOL_N + 1):]]
        rets = [math.log(b / a) for a, b in zip(closes, closes[1:])]
        vol = statistics.stdev(rets)

        ys = [c.close - candles[-TREND_N].close for c in candles[-TREND_N:]]
        xm = (TREND_N - 1) / 2
        ym = sum(ys) / TREND_N
        den = sum((x - xm) ** 2 for x in range(TREND_N))
        slope = sum((x - xm) * (y - ym) for x, y in enumerate(ys)) / den
        trend = slope / last.close

        imb_c = candles[-IMB_N:]
        imbalance = _weighted([_clv(c) for c in imb_c], [c.tick_volume for c in imb_c])
        flow_c = candles[-FLOW_N:]
        flow = _weighted([float(_sign(c.close - c.open)) for c in flow_c], [c.tick_volume for c in flow_c])

        return Snapshot(
            ts=decision_ts, price=last.close, spread_points=last.spread_points,
            imbalance=imbalance, realized_vol=vol, trend=trend, flow=flow,
        )

    def snapshot_at(self, source: CandleSource, decision_ts: datetime) -> Snapshot | None:
        return self.snapshot(source.closed_candles(decision_ts, count=self.min_candles), decision_ts)
