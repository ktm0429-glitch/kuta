import random

import pytest

from xbot.sizing import kelly_multiplier, size_trade
from xbot.strategy_rules import load_strategy


@pytest.fixture
def rules():
    return load_strategy("strategy.example.md")


def test_multiplier_zero_below_cutoff(rules):
    assert kelly_multiplier(0.49, rules.sizing) == 0


def test_multiplier_base_at_cutoff_and_max_at_full(rules):
    assert kelly_multiplier(0.50, rules.sizing) == pytest.approx(0.10)
    assert kelly_multiplier(0.65, rules.sizing) == pytest.approx(0.25)
    assert kelly_multiplier(0.99, rules.sizing) == pytest.approx(0.25)


def test_multiplier_monotonic_and_never_above_quarter(rules):
    ps = [i / 100 for i in range(0, 101)]
    ms = [kelly_multiplier(p, rules.sizing) for p in ps]
    assert ms == sorted(ms) and max(ms) <= 0.25


def wide(cfg):
    return cfg.model_copy(update={"max_risk_per_trade_pct": 100.0, "max_position_lots": 100.0})


def test_kelly_known_value(rules, cfg):
    # p=.65, b=1.5 -> f*=(.975-.35)/1.5=.41667 ; x0.25 = 0.104167 ; equity 100k -> $10,416.67 risk
    r = size_trade(0.65, 1.5, stop_distance=50.0, equity=100_000.0, rules=rules, cfg=wide(cfg), calibrated=True)
    assert r.kelly_full == pytest.approx(0.416667, abs=1e-5)
    assert r.multiplier == pytest.approx(0.25)
    assert r.risk_amount == pytest.approx(0.25 * 0.416667 * 100_000, rel=1e-4)
    assert r.lots == pytest.approx(2.08)  # 10416.67 / (50*100) = 2.083 -> floored to the 0.01 step


def test_zero_when_no_edge(rules, cfg):
    # p=.5 passes the cutoff but b=1.5 -> f* = (.75-.5)/1.5 > 0 ; use b=1.0 -> f*=0
    r = size_trade(0.50, 1.0, 5.0, 10_000.0, rules, cfg, calibrated=True)
    assert r.lots == 0 and r.kelly_full == 0


def test_zero_below_cutoff(rules, cfg):
    assert size_trade(0.45, 1.5, 5.0, 10_000.0, rules, cfg, calibrated=True).lots == 0


def test_risk_cap_limits_size(rules, cfg):
    # equity 10k, cap 1% x 0.8 = $80 ; stop $5 -> $500/lot -> 0.16 lots -> capped by max_position_lots 0.10
    r = size_trade(0.99, 1.5, 5.0, 10_000.0, rules, cfg, calibrated=True)
    assert r.lots == pytest.approx(0.10)


def test_lots_rounded_down_to_step(rules, cfg):
    r = size_trade(0.99, 1.5, 12.0, 10_000.0, rules, cfg, calibrated=True)  # 80/1200 = 0.0667 -> 0.06
    assert r.lots == pytest.approx(0.06)


def test_below_min_lot_is_zero(rules, cfg):
    assert size_trade(0.99, 1.5, 100.0, 10_000.0, rules, cfg, calibrated=True).lots == 0  # 80/10000=0.008


def test_uncalibrated_uses_probe_size_only(rules, cfg):
    r = size_trade(0.80, 1.5, 5.0, 10_000.0, rules, cfg, calibrated=False)
    assert r.lots == pytest.approx(0.01) and "uncalibrated" in r.reason


def test_uncalibrated_probe_still_zero_without_edge(rules, cfg):
    assert size_trade(0.45, 1.5, 5.0, 10_000.0, rules, cfg, calibrated=False).lots == 0


def test_max_lots_override_for_unattended_mode(rules, cfg):
    r = size_trade(0.99, 1.5, 5.0, 10_000.0, rules, cfg, calibrated=True, max_lots=cfg.approval_threshold_lots)
    assert r.lots == pytest.approx(0.05)


def test_risk_never_exceeds_cap_property(rules, cfg):
    rnd = random.Random(0)
    for _ in range(2000):
        p, b = rnd.uniform(0.3, 1.0), rnd.uniform(0.5, 4.0)
        stop, eq = rnd.uniform(1.0, 80.0), rnd.uniform(1_000, 200_000)
        r = size_trade(p, b, stop, eq, rules, cfg, calibrated=rnd.random() < 0.5)
        assert r.lots * stop * 100 <= 0.8 * cfg.max_risk_per_trade_pct / 100 * eq + 1e-6
        assert r.lots <= cfg.max_position_lots + 1e-9
