"""Glue: scorer -> decision -> sizing -> OrderRequest. Usable directly as a backtest Strategy.

The brain only PROPOSES an order; the risk gate and router still decide whether it is sent.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Callable

from .backtest import Context
from .config import RiskConfig
from .decision import Action, Decision, decide
from .models import OrderRequest, Side
from .scorer import Scorer, Scores, ValidatingScorer
from .sizing import SizeResult, size_trade
from .state import Snapshot
from .strategy_rules import StrategyRules


@dataclass(frozen=True)
class DecisionRecord:
    ts: datetime
    snapshot: Snapshot
    scores: Scores
    decision: Decision
    size: SizeResult | None


class Brain:
    def __init__(
        self,
        scorer: Scorer,
        rules: StrategyRules,
        cfg: RiskConfig,
        calibrated: bool | Callable[[], bool] = False,
        unattended: bool = True,
        sink: Callable[[DecisionRecord], None] | None = None,
    ):
        self.scorer = ValidatingScorer(scorer)
        self.rules, self.cfg, self.sink = rules, cfg, sink
        self._calibrated = calibrated if callable(calibrated) else (lambda: calibrated)
        # unattended runs cannot answer approval prompts, so stay at/below the approval threshold
        self.max_lots = min(cfg.max_position_lots, cfg.approval_threshold_lots) if unattended else cfg.max_position_lots

    def __call__(self, snap: Snapshot, ctx: Context) -> OrderRequest | None:
        if ctx.positions:
            return None
        scores = self.scorer.score(snap)
        d = decide(scores, snap, self.rules)
        size = None
        if d.action is not Action.NONE:
            size = size_trade(d.p_win, d.r_multiple, d.stop_distance, ctx.account.equity, self.rules,
                              self.cfg, self._calibrated(), max_lots=self.max_lots)
        if self.sink:
            self.sink(DecisionRecord(ctx.ts, snap, scores, d, size))
        if size is None or size.lots <= 0:
            return None
        side = Side.BUY if d.action is Action.BUY else Side.SELL
        return OrderRequest(side, size.lots, d.sl, d.tp,
                            f"combined={d.combined:.2f} p={d.p_win:.2f} {size.reason}")
