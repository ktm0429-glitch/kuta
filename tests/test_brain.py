from datetime import datetime, timezone

import pytest

from xbot.backtest import Context
from xbot.brain import Brain
from xbot.models import AccountState, Position, Side
from xbot.scorer import Scores
from xbot.state import Snapshot
from xbot.strategy_rules import load_strategy

T = datetime(2026, 1, 5, tzinfo=timezone.utc)


class Fixed:
    def __init__(self, scores):
        self.scores = scores

    def score(self, snap):
        return self.scores


def good_scores(**kw):
    base = dict(
        regime={"trending": 0.7, "ranging": 0.2, "volatile": 0.1},
        direction={"up": 0.7, "down": 0.1, "none": 0.2}, pressure_real=0.7,
        setup_quality={"up": 0.62, "down": 0.3}, risk_state={"normal": 0.8, "elevated": 0.15, "halt": 0.05},
    )
    base.update(kw)
    return Scores(**base)


def snap():
    return Snapshot(T, 2000.0, 20.0, 0.2, 0.0005, 0.0001, 0.3)


def ctx(positions=(), equity=10_000.0):
    return Context(T, list(positions), AccountState(equity, equity))


@pytest.fixture
def rules():
    return load_strategy("strategy.example.md")


def test_produces_order_with_stops_and_probe_size_when_uncalibrated(rules, cfg):
    o = Brain(Fixed(good_scores()), rules, cfg, calibrated=False)(snap(), ctx())
    assert o.side is Side.BUY and o.lots == pytest.approx(0.01) and o.sl < 2000 < o.tp


def test_calibrated_sizes_up_but_stays_under_approval_threshold_when_unattended(rules, cfg):
    o = Brain(Fixed(good_scores(setup_quality={"up": 0.9, "down": 0.1})), rules, cfg, calibrated=True)(snap(), ctx(equity=500_000))
    assert 0.01 < o.lots <= cfg.approval_threshold_lots


def test_attended_mode_may_exceed_approval_threshold(rules, cfg):
    wide = cfg.model_copy(update={"max_risk_per_trade_pct": 5.0})
    b = Brain(Fixed(good_scores(setup_quality={"up": 0.9, "down": 0.1})), rules, wide, calibrated=True, unattended=False)
    assert b(snap(), ctx(equity=500_000)).lots > cfg.approval_threshold_lots


def test_no_order_when_decision_is_none(rules, cfg):
    assert Brain(Fixed(good_scores(pressure_real=0.1)), rules, cfg)(snap(), ctx()) is None


def test_no_order_while_a_position_is_open(rules, cfg):
    pos = Position(1, Side.BUY, 0.01, 2000, 1990, 2010)
    assert Brain(Fixed(good_scores()), rules, cfg)(snap(), ctx([pos])) is None


def test_every_call_is_logged_to_sink_including_skips(rules, cfg):
    got = []
    b = Brain(Fixed(good_scores(pressure_real=0.1)), rules, cfg, sink=got.append)
    b(snap(), ctx())
    Brain(Fixed(good_scores()), rules, cfg, sink=got.append)(snap(), ctx())
    assert len(got) == 2 and got[0].decision.action.value == "none" and got[1].decision.action.value == "buy"
    assert got[1].size.lots > 0 and got[1].scores.pressure_real == 0.7


def test_calibration_callable_is_consulted_each_time(rules, cfg):
    flag = {"ok": False}
    b = Brain(Fixed(good_scores()), rules, cfg, calibrated=lambda: flag["ok"])
    small = b(snap(), ctx(equity=500_000)).lots
    flag["ok"] = True
    assert b(snap(), ctx(equity=500_000)).lots > small
