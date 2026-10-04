"""Position sizing: capped fraction of Kelly from a CALIBRATED probability.

Kelly for a bet that wins +b R or loses 1 R:  f* = (p*b - (1-p)) / b.
Used fraction = multiplier(p) * f*, where multiplier rises from base_multiplier at p_cutoff to
max_multiplier (<= 0.25, quarter Kelly) at p_full; it is 0 below p_cutoff. Risk is further capped
at 80% of the hard per-trade limit (headroom for spread/gaps between decision and fill), and lots are
floored to the lot step. Until calibration is verified only a minimum "probe" size is used.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

from .config import RiskConfig
from .strategy_rules import SizingRules, StrategyRules

CONTRACT_SIZE = 100
RISK_HEADROOM = 0.8


@dataclass(frozen=True)
class SizeResult:
    lots: float
    risk_amount: float
    kelly_full: float
    multiplier: float
    reason: str


def kelly_multiplier(p: float, s: SizingRules) -> float:
    if p < s.p_cutoff:
        return 0.0
    t = min(1.0, (p - s.p_cutoff) / (s.p_full - s.p_cutoff))
    return min(s.max_multiplier, s.base_multiplier + (s.max_multiplier - s.base_multiplier) * t)


def _floor_to_step(x: float, step: float) -> float:
    return round(math.floor(x / step + 1e-9) * step, 8)


def size_trade(
    p_win: float,
    r_multiple: float,
    stop_distance: float,
    equity: float,
    rules: StrategyRules,
    cfg: RiskConfig,
    calibrated: bool,
    max_lots: float | None = None,
    lot_step: float = 0.01,
    min_lot: float = 0.01,
) -> SizeResult:
    kelly = max(0.0, (p_win * r_multiple - (1 - p_win)) / r_multiple)
    mult = kelly_multiplier(p_win, rules.sizing)
    cap_lots = cfg.max_position_lots if max_lots is None else min(max_lots, cfg.max_position_lots)
    risk_cap = RISK_HEADROOM * cfg.max_risk_per_trade_pct / 100 * equity
    per_lot = stop_distance * CONTRACT_SIZE
    if kelly <= 0 or mult <= 0 or equity <= 0 or per_lot <= 0:
        return SizeResult(0.0, 0.0, kelly, mult, "no edge or below probability cutoff")

    if not calibrated:
        lots = min_lot if min_lot * per_lot <= risk_cap and min_lot <= cap_lots else 0.0
        return SizeResult(lots, lots * per_lot, kelly, mult, "uncalibrated: probe size")

    risk_amount = min(mult * kelly * equity, risk_cap)
    lots = min(_floor_to_step(risk_amount / per_lot, lot_step), cap_lots)
    if lots < min_lot:
        return SizeResult(0.0, 0.0, kelly, mult, "below minimum lot")
    return SizeResult(lots, risk_amount, kelly, mult, "kelly")
