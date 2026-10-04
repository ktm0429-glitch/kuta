"""Broker interface and the simulated broker used by backtests and tests."""
from __future__ import annotations

from datetime import datetime
from typing import Protocol

from .models import AccountState, ClosedPosition, Fill, MarketState, Position, Side
from .risk import ApprovedOrder


class Broker(Protocol):
    def account(self) -> AccountState: ...
    def positions(self) -> list[Position]: ...
    def market(self) -> MarketState: ...
    def send(self, approved: ApprovedOrder) -> Fill: ...
    def flatten_all(self, ts: datetime, reason: str = "flatten") -> list[Fill]: ...


class SimBroker:
    """Simulated broker. Bar data is BID-based: longs exit at bid, shorts exit at ask (= bid + spread).

    Stops fill at the stop price, or at the open when the bar gaps through it;
    slippage always works against us on market entries and stop exits. If a bar
    touches both stop and target, the stop is assumed to hit first.
    """

    CONTRACT_SIZE = 100  # oz per lot for XAUUSD

    def __init__(self, balance: float, slippage_points: float = 0.0):
        self._balance = balance
        self._slip = slippage_points
        self._positions: list[Position] = []
        self._market: MarketState | None = None
        self._next_id = 1
        self.closed: list[ClosedPosition] = []

    # --- state -----------------------------------------------------------
    def set_balance(self, balance: float) -> None:
        self._balance = balance

    def set_market(self, market: MarketState, check_exits: bool = True) -> None:
        self._market = market
        if check_exits:
            self.process_open()

    def market(self) -> MarketState:
        assert self._market is not None, "market not set"
        return self._market

    def positions(self) -> list[Position]:
        return list(self._positions)

    def _pnl(self, p: Position, price: float) -> float:
        sign = 1 if p.side is Side.BUY else -1
        return sign * (price - p.entry) * p.lots * self.CONTRACT_SIZE

    def _exit_price(self, p: Position) -> float:
        m = self.market()
        return m.bid if p.side is Side.BUY else m.ask

    def account(self) -> AccountState:
        unreal = sum(self._pnl(p, self._exit_price(p)) for p in self._positions)
        return AccountState(balance=self._balance, equity=self._balance + unreal)

    def worst_case_equity(self, high: float, low: float, spread_points: float) -> float:
        sp = spread_points * self.market().point
        worst = self._balance
        for p in self._positions:
            worst += self._pnl(p, low if p.side is Side.BUY else high + sp)
        return worst

    # --- trading ---------------------------------------------------------
    def send(self, approved: ApprovedOrder) -> Fill:
        if not isinstance(approved, ApprovedOrder):
            raise TypeError("Broker only accepts ApprovedOrder from RiskGate")
        o, m = approved.order, self.market()
        slip = self._slip * m.point
        price = m.ask + slip if o.side is Side.BUY else m.bid - slip
        pos = Position(self._next_id, o.side, o.lots, price, o.sl, o.tp, opened_at=m.ts)
        self._next_id += 1
        self._positions.append(pos)
        return Fill(pos.id, o.side, o.lots, price, m.ts)

    def _close(self, p: Position, price: float, ts: datetime, reason: str) -> None:
        pnl = self._pnl(p, price)
        self._balance += pnl
        self._positions.remove(p)
        self.closed.append(ClosedPosition(p, price, ts, pnl, reason))

    def process_open(self) -> None:
        """Exits that trigger at the current price itself (gaps through stops/targets)."""
        m = self.market()
        slip = self._slip * m.point
        for p in list(self._positions):
            if p.side is Side.BUY:
                px = m.bid
                if p.sl is not None and px <= p.sl:
                    self._close(p, px - slip, m.ts, "sl")
                elif p.tp is not None and px >= p.tp:
                    self._close(p, px, m.ts, "tp")
            else:
                px = m.ask
                if p.sl is not None and px >= p.sl:
                    self._close(p, px + slip, m.ts, "sl")
                elif p.tp is not None and px <= p.tp:
                    self._close(p, px, m.ts, "tp")

    def process_range(self, high: float, low: float, spread_points: float, ts: datetime) -> None:
        """Intrabar exits from the bar's high/low (bid-based). Stop wins ties."""
        m = self.market()
        slip, sp = self._slip * m.point, spread_points * m.point
        for p in list(self._positions):
            if p.side is Side.BUY:
                if p.sl is not None and low <= p.sl:
                    self._close(p, p.sl - slip, ts, "sl")
                elif p.tp is not None and high >= p.tp:
                    self._close(p, p.tp, ts, "tp")
            else:
                if p.sl is not None and high + sp >= p.sl:
                    self._close(p, p.sl + slip, ts, "sl")
                elif p.tp is not None and low + sp <= p.tp:
                    self._close(p, p.tp, ts, "tp")

    def flatten_all(self, ts: datetime, reason: str = "flatten") -> list[Fill]:
        fills = []
        for p in list(self._positions):
            px = self._exit_price(p)
            self._close(p, px, ts, reason)
            fills.append(Fill(p.id, p.side, p.lots, px, ts))
        return fills
