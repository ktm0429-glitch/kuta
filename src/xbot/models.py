from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from enum import Enum


class Side(str, Enum):
    BUY = "buy"
    SELL = "sell"


@dataclass(frozen=True)
class OrderRequest:
    side: Side
    lots: float
    sl: float | None
    tp: float | None = None
    reason: str = ""


@dataclass(frozen=True)
class Position:
    id: int
    side: Side
    lots: float
    entry: float
    sl: float | None
    tp: float | None


@dataclass(frozen=True)
class Fill:
    order_id: int
    side: Side
    lots: float
    price: float
    ts: datetime


@dataclass(frozen=True)
class AccountState:
    balance: float
    equity: float


@dataclass(frozen=True)
class MarketState:
    ts: datetime
    bid: float
    ask: float
    last_candle_ts: datetime
    point: float = 0.01

    @property
    def spread_points(self) -> float:
        return (self.ask - self.bid) / self.point


@dataclass(frozen=True)
class Candle:
    """OHLC bar. ts is the OPEN time (UTC). The bar is only knowable at close_ts."""

    ts: datetime
    open: float
    high: float
    low: float
    close: float
    tick_volume: float
    spread_points: float
    duration_s: int = 300

    @property
    def close_ts(self) -> datetime:
        return self.ts + timedelta(seconds=self.duration_s)
