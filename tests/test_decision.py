import pytest

from xbot.decision import Action, decide
from xbot.scorer import Scores
from xbot.state import Snapshot
from xbot.strategy_rules import load_strategy
from datetime import datetime, timezone


@pytest.fixture
def rules():
    return load_strategy("strategy.example.md")


def snap(price=2000.0, vol=0.0005, spread=20):
    return Snapshot(datetime(2026, 1, 5, tzinfo=timezone.utc), price, spread, 0.2, vol, 0.0001, 0.3)


def scores(**kw):
    base = dict(
        regime={"trending": 0.7, "ranging": 0.2, "volatile": 0.1},
        direction={"up": 0.7, "down": 0.1, "none": 0.2},
        pressure_real=0.7,
        setup_quality={"up": 0.62, "down": 0.3},
        risk_state={"normal": 0.8, "elevated": 0.15, "halt": 0.05},
    )
    base.update(kw)
    return Scores(**base)


def test_all_clear_buys(rules):
    d = decide(scores(), snap(), rules)
    assert d.action is Action.BUY and d.p_win == 0.62 and d.r_multiple == 1.5


def test_down_direction_sells_and_uses_down_quality(rules):
    s = scores(direction={"up": 0.1, "down": 0.7, "none": 0.2}, setup_quality={"up": 0.3, "down": 0.6})
    d = decide(s, snap(), rules)
    assert d.action is Action.SELL and d.p_win == 0.6


def test_stops_geometry_buy(rules):
    d = decide(scores(), snap(price=2000.0, vol=0.0005, spread=20), rules)
    # dist = max(4 * 0.0005 * 2000 = 4.0, 300 pts = 3.0) = 4.0 ; entry est = 2000.20
    assert d.stop_distance == pytest.approx(4.0)
    assert d.sl == pytest.approx(2000.20 - 4.0) and d.tp == pytest.approx(2000.20 + 6.0)


def test_stops_geometry_sell(rules):
    s = scores(direction={"up": 0.1, "down": 0.7, "none": 0.2}, setup_quality={"up": 0.3, "down": 0.6})
    d = decide(s, snap(), rules)
    assert d.sl == pytest.approx(2000.0 + 4.0) and d.tp == pytest.approx(2000.0 - 6.0)


def test_min_stop_floor(rules):
    d = decide(scores(), snap(vol=0.00001), rules)  # 4*0.00001*2000 = 0.08 -> floor 3.0
    assert d.stop_distance == pytest.approx(3.0)


@pytest.mark.parametrize(
    "kw,needle",
    [
        (dict(direction={"up": 0.45, "down": 0.1, "none": 0.45}), "direction"),
        (dict(pressure_real=0.49), "pressure"),
        (dict(setup_quality={"up": 0.49, "down": 0.3}), "quality"),
        (dict(regime={"trending": 0.39, "ranging": 0.5, "volatile": 0.11}), "regime"),
        (dict(risk_state={"normal": 0.49, "elevated": 0.4, "halt": 0.11}), "risk"),
        (dict(risk_state={"normal": 0.6, "elevated": 0.2, "halt": 0.2}), "risk"),
    ],
)
def test_each_threshold_blocks_trade(rules, kw, needle):
    d = decide(scores(**kw), snap(), rules)
    assert d.action is Action.NONE and any(needle in r for r in d.reasons)


def test_exactly_at_threshold_passes(rules):
    s = scores(pressure_real=0.50, setup_quality={"up": 0.50, "down": 0.3})
    d = decide(s, snap(), rules)
    assert d.action is Action.BUY  # >= passes; combined = 0.60 clears 0.50


def test_combined_threshold_uses_explicit_weights(rules):
    d = decide(scores(), snap(), rules)
    w = rules.weights
    expected = (w.direction * 0.7 + w.pressure * 0.7 + w.quality * 0.62 + w.regime * 0.7 + w.risk * 0.8)
    assert d.combined == pytest.approx(expected)


def test_combined_blocks_when_individually_clear_but_weak(rules):
    s = scores(
        direction={"up": 0.5, "down": 0.1, "none": 0.4}, pressure_real=0.5,
        setup_quality={"up": 0.5, "down": 0.3},
        regime={"trending": 0.4, "ranging": 0.4, "volatile": 0.2},
        risk_state={"normal": 0.5, "elevated": 0.35, "halt": 0.15},
    )
    r2 = rules.model_copy(update={"thresholds": rules.thresholds.model_copy(update={"combined_min": 0.6})})
    d = decide(s, snap(), r2)
    assert d.action is Action.NONE and any("combined" in r for r in d.reasons)


def test_none_decision_has_no_stops(rules):
    d = decide(scores(pressure_real=0.1), snap(), rules)
    assert d.sl is None and d.tp is None
