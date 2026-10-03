"""Broker interface and the simulated broker used by backtests and tests."""
from __future__ import annotations

from datetime import datetime
from typing import Protocol

from .models import AccountState, Fill, MarketState, Position, Side
from .risk import ApprovedOrder


class Broker(Protocol):
    def account(self) -> AccountState: ...
    def positions(self) -> list[Position]: ...
    def market(self) -> MarketState: ...
    def send(self, approved: ApprovedOrder) -> Fill: ...
    def flatten_all(self, ts: datetime) -> list[Fill]: ...


class SimBroker:
    CONTRACT_SIZE = 100  # oz per lot for XAUUSD

    def __init__(self, balance: float, slippage_points: float = 0.0):
        self._balance = balance
        self._slip = slippage_points
        self._positions: list[Position] = []
        self._market: MarketState | None = None
        self._next_id = 1

    # --- state -----------------------------------------------------------
    def set_balance(self, balance: float) -> None:
        self._balance = balance

    def set_market(self, market: MarketState) -> None:
        self._market = market
        self._check_exits()

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

    # --- trading ---------------------------------------------------------
    def send(self, approved: ApprovedOrder) -> Fill:
        if not isinstance(approved, ApprovedOrder):
            raise TypeError("Broker only accepts ApprovedOrder from RiskGate")
        o, m = approved.order, self.market()
        slip = self._slip * m.point
        price = m.ask + slip if o.side is Side.BUY else m.bid - slip
        pos = Position(self._next_id, o.side, o.lots, price, o.sl, o.tp)
        self._next_id += 1
        self._positions.append(pos)
        return Fill(pos.id, o.side, o.lots, price, m.ts)

    def _close(self, p: Position, price: float) -> None:
        self._balance += self._pnl(p, price)
        self._positions.remove(p)

    def _check_exits(self) -> None:
        for p in list(self._positions):
            px = self._exit_price(p)
            hit_sl = p.sl is not None and (px <= p.sl if p.side is Side.BUY else px >= p.sl)
            hit_tp = p.tp is not None and (px >= p.tp if p.side is Side.BUY else px <= p.tp)
            if hit_sl:
                self._close(p, p.sl)
            elif hit_tp:
                self._close(p, p.tp)

    def flatten_all(self, ts: datetime) -> list[Fill]:
        fills = []
        for p in list(self._positions):
            px = self._exit_price(p)
            self._close(p, px)
            fills.append(Fill(p.id, p.side, p.lots, px, ts))
        return fills
