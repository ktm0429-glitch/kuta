"""Combine the scorer's fixed-outcome probabilities with explicit weights and strategy.md thresholds.

Every probability must clear its own threshold (>=) AND the weighted score must clear combined_min.
All failed checks are reported, not just the first, so losses can be analysed later.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from .scorer import Scores
from .state import Snapshot
from .strategy_rules import StrategyRules

POINT = 0.01


class Action(Enum):
    BUY = "buy"
    SELL = "sell"
    NONE = "none"


@dataclass(frozen=True)
class Decision:
    action: Action
    reasons: list[str] = field(default_factory=list)
    combined: float = 0.0
    p_win: float = 0.0
    r_multiple: float = 0.0
    stop_distance: float = 0.0
    sl: float | None = None
    tp: float | None = None


def decide(scores: Scores, snap: Snapshot, rules: StrategyRules) -> Decision:
    th, w, st = rules.thresholds, rules.weights, rules.stops
    side = "up" if scores.direction["up"] >= scores.direction["down"] else "down"
    p_dir = scores.direction[side]
    p_quality = scores.setup_quality[side]
    p_regime = sum(scores.regime[r] for r in rules.allowed_regimes)
    p_normal, p_halt = scores.risk_state["normal"], scores.risk_state["halt"]

    combined = (w.direction * p_dir + w.pressure * scores.pressure_real + w.quality * p_quality
                + w.regime * p_regime + w.risk * p_normal)

    fails = []
    if p_dir < th.direction_min:
        fails.append(f"direction {p_dir:.2f} < {th.direction_min}")
    if scores.pressure_real < th.pressure_min:
        fails.append(f"pressure {scores.pressure_real:.2f} < {th.pressure_min}")
    if p_quality < th.quality_min:
        fails.append(f"quality {p_quality:.2f} < {th.quality_min}")
    if p_regime < th.regime_min:
        fails.append(f"regime {p_regime:.2f} < {th.regime_min}")
    if p_normal < th.risk_normal_min:
        fails.append(f"risk normal {p_normal:.2f} < {th.risk_normal_min}")
    if p_halt > th.risk_halt_max:
        fails.append(f"risk halt {p_halt:.2f} > {th.risk_halt_max}")
    if combined < th.combined_min:
        fails.append(f"combined {combined:.2f} < {th.combined_min}")
    if fails:
        return Decision(Action.NONE, fails, combined)

    dist = max(st.stop_vol_mult * snap.realized_vol * snap.price, st.min_stop_points * POINT)
    if side == "up":
        entry = snap.price + snap.spread_points * POINT  # expected fill at the ask
        sl, tp, action = entry - dist, entry + st.r_multiple * dist, Action.BUY
    else:
        entry = snap.price                               # expected fill at the bid
        sl, tp, action = entry + dist, entry - st.r_multiple * dist, Action.SELL
    return Decision(action, ["all checks passed"], combined, p_quality, st.r_multiple, dist, sl, tp)
