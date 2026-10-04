import math
import random
from datetime import datetime, timedelta, timezone

import pytest

from xbot.calibration import (
    CalibratedScorer, CalibrationThresholds, Isotonic, Platt, Prediction, brier_score, calibration_report,
    check_calibration, ece, fit_isotonic, fit_platt, load_logged_decisions, journal_sink,
    predictions_from_decisions, recalibrators_from, reliability_curve, trade_predictions,
)
from xbot.journal import Journal
from xbot.scorer import REGIMES, DIRECTIONS, RISK_STATES, Scores

T0 = datetime(2026, 1, 5, tzinfo=timezone.utc)


def sample(n, seed, true_fn, q="quality_up"):
    rnd = random.Random(seed)
    out = []
    for _ in range(n):
        p = rnd.uniform(0.05, 0.95)
        out.append(Prediction(q, p, int(rnd.random() < true_fn(p))))
    return out


def split(preds):
    return [p.p for p in preds], [p.y for p in preds]


# ---- basic measures -------------------------------------------------------------
def test_brier_known_values():
    assert brier_score([0.5, 0.5], [1, 0]) == pytest.approx(0.25)
    assert brier_score([1.0, 0.0], [1, 0]) == 0.0
    with pytest.raises(ValueError):
        brier_score([0.5], [1, 0])


def test_reliability_curve_bins_and_edges():
    bins = reliability_curve([0.05, 0.05, 0.95, 0.95, 1.0], [0, 1, 1, 1, 1], n_bins=10)
    assert [b.n for b in bins] == [2, 3]                      # empty bins omitted; p=1.0 in last bin
    assert bins[0].mean_p == pytest.approx(0.05) and bins[0].freq == pytest.approx(0.5)
    assert bins[1].freq == 1.0


def test_ece_known_value():
    assert ece([0.05, 0.05, 0.95, 0.95], [0, 1, 1, 1]) == pytest.approx(0.25)


# ---- diagnosing calibration ---------------------------------------------------------
def test_well_calibrated_predictor_looks_calibrated():
    r = calibration_report(sample(20_000, 1, lambda p: p))["quality_up"]
    assert r.ece < 0.02 and 0.9 < r.slope < 1.1 and abs(r.intercept) < 0.1
    assert r.n == 20_000


def test_overconfident_predictor_is_detected():
    r = calibration_report(sample(20_000, 2, lambda p: 0.5 + 0.4 * (p - 0.5)))["quality_up"]
    assert r.ece > 0.1 and r.slope < 0.6


def test_status_blocks_overconfident_and_passes_calibrated():
    th = CalibrationThresholds(min_trades=0)
    bad = {"quality_up": sample(5000, 3, lambda p: 0.5 + 0.4 * (p - 0.5)), "quality_down": sample(5000, 4, lambda p: p, "quality_down")}
    good = {"quality_up": sample(5000, 5, lambda p: p), "quality_down": sample(5000, 6, lambda p: p, "quality_down")}
    flat = lambda d: [x for v in d.values() for x in v]
    s_bad = check_calibration(calibration_report(flat(bad)), [], th)
    s_good = check_calibration(calibration_report(flat(good)), [], th)
    assert not s_bad.ok and any("quality_up" in r for r in s_bad.reasons)
    assert s_good.ok, s_good.reasons


def test_status_requires_enough_samples():
    s = check_calibration(calibration_report(sample(100, 7, lambda p: p) + sample(100, 8, lambda p: p, "quality_down")),
                          [], CalibrationThresholds(min_trades=0))
    assert not s.ok and any("samples" in r for r in s.reasons)


def test_status_requires_both_sizing_questions():
    s = check_calibration(calibration_report(sample(5000, 9, lambda p: p)), [], CalibrationThresholds(min_trades=0))
    assert not s.ok and any("quality_down" in r for r in s.reasons)


def test_status_needs_skill_over_base_rate():
    # p carries no information: always 0.5 while the outcome rate is 0.5 -> calibrated but useless
    rnd = random.Random(1)
    preds = [Prediction(q, 0.5, int(rnd.random() < 0.5)) for q in ("quality_up", "quality_down") for _ in range(3000)]
    s = check_calibration(calibration_report(preds), [], CalibrationThresholds(min_trades=0, min_skill=0.001))
    assert not s.ok and any("skill" in r for r in s.reasons)


def trades_preds(n, p, rate, seed=0):
    rnd = random.Random(seed)
    return [Prediction("trade_win", p, int(rnd.random() < rate)) for _ in range(n)]


def good_bar_report():
    return calibration_report(sample(5000, 11, lambda p: p) + sample(5000, 12, lambda p: p, "quality_down"))


def test_own_fills_must_be_enough_and_match_predictions():
    th = CalibrationThresholds()
    assert not check_calibration(good_bar_report(), trades_preds(10, 0.6, 0.6), th).ok          # too few fills
    assert check_calibration(good_bar_report(), trades_preds(200, 0.6, 0.6), th).ok
    s = check_calibration(good_bar_report(), trades_preds(200, 0.6, 0.35), th)                    # fills disagree
    assert not s.ok and any("own fills" in r for r in s.reasons)


# ---- recalibration --------------------------------------------------------------------
def test_platt_fixes_overconfidence_out_of_sample():
    data = sample(20_000, 13, lambda p: 0.5 + 0.4 * (p - 0.5))
    fit, hold = data[:10_000], data[10_000:]
    platt = fit_platt(*split(fit))
    assert 0.3 < platt.a < 0.5
    adj = [Prediction(h.question, platt.apply(h.p), h.y) for h in hold]
    assert ece(*split(adj)) < 0.02 and ece(*split(hold)) > 0.1
    assert calibration_report(adj)["quality_up"].slope == pytest.approx(1.0, abs=0.15)


def test_platt_is_safe_on_degenerate_input():
    assert fit_platt([0.2, 0.8], [1, 1]).apply(0.5) == pytest.approx(0.5)  # single class -> identity
    p = Platt(2.0, 0.0)
    assert 0 < p.apply(0.0) < 1 and 0 < p.apply(1.0) < 1


def test_isotonic_fixes_non_sigmoid_miscalibration():
    rnd = random.Random(3)
    data = [(p, int(rnd.random() < p * p)) for p in (rnd.random() for _ in range(30_000))]
    fit, hold = data[:15_000], data[15_000:]
    iso = fit_isotonic([p for p, _ in fit], [y for _, y in fit])
    adj = [iso.apply(p) for p, _ in hold]
    assert ece(adj, [y for _, y in hold]) < 0.03
    grid = [iso.apply(x / 100) for x in range(101)]
    assert grid == sorted(grid) and 0 < min(grid) and max(grid) < 1


def test_recalibrators_from_predictions():
    preds = sample(8000, 15, lambda p: 0.5 + 0.4 * (p - 0.5)) + sample(8000, 16, lambda p: p, "quality_down")
    rec = recalibrators_from(preds, method="platt")
    assert set(rec) == {"quality_up", "quality_down"}
    assert rec["quality_up"].apply(0.9) < 0.75                  # pulled in
    assert rec["quality_down"].apply(0.9) == pytest.approx(0.9, abs=0.05)  # already fine


# ---- scorer wrapper ----------------------------------------------------------------------
class Over:
    def score(self, snap):
        return Scores(
            regime={r: 1 / 3 for r in REGIMES}, direction={"up": 0.8, "down": 0.1, "none": 0.1}, pressure_real=0.9,
            setup_quality={"up": 0.9, "down": 0.1}, risk_state={s: 1 / 3 for s in RISK_STATES},
        )


def test_calibrated_scorer_adjusts_probabilities_and_stays_valid():
    rec = {"quality_up": Platt(0.5, 0.0), "direction_up": Platt(0.5, 0.0), "pressure_real": Platt(0.5, 0.0)}
    s = CalibratedScorer(Over(), rec).score(None)
    s.validate()
    assert 0.5 < s.setup_quality["up"] < 0.9 and 0.5 < s.pressure_real < 0.9
    assert s.direction["up"] < 0.8 and sum(s.direction.values()) == pytest.approx(1.0)
    assert s.setup_quality["down"] == pytest.approx(0.1)        # no recalibrator => unchanged
    assert s.regime == Over().score(None).regime


def test_calibrated_scorer_without_recalibrators_is_identity():
    assert CalibratedScorer(Over(), {}).score(None) == Over().score(None)


# ---- logging, outcome resolution, own fills ------------------------------------------------
np = pytest.importorskip("numpy")
from test_scorer import SPEC, planted, snapshots  # noqa: E402
from xbot.backtest import CostModel, Trade, run_backtest  # noqa: E402
from xbot.brain import Brain  # noqa: E402
from xbot.labels import LabelSpec, build_labels  # noqa: E402
from xbot.scorer import LocalScorer  # noqa: E402
from xbot.strategy_rules import load_strategy  # noqa: E402


@pytest.fixture(scope="module")
def run(tmp_path_factory):
    from xbot.config import load_risk_config
    return logged_run(load_risk_config("config/risk.yaml"), tmp_path_factory.mktemp("cal"))


def logged_run(cfg, tmp_path, n=26_000, split_at=14_000):
    rules = load_strategy("strategy.example.md")
    cs, _ = planted(n, seed=21)
    scorer = LocalScorer.fit(cs[:split_at], LabelSpec.from_rules(rules))
    journal = Journal(tmp_path / "j.sqlite", fast=True)
    brain = Brain(scorer, rules, cfg, calibrated=False, sink=journal_sink(journal))
    res = run_backtest(cs, brain, cfg, 10_000.0, CostModel(2), trade_from=cs[split_at].ts)
    return rules, cs, journal, res


def test_journal_roundtrip_of_decisions(run):
    rules, cs, journal, res = run
    dec = load_logged_decisions(journal)
    assert len(dec) > 100 and dec[0].ts.tzinfo is not None
    dec[0].scores.validate()


def test_predictions_resolved_from_future_candles_only(run):
    rules, cs, journal, res = run
    spec = LabelSpec.from_rules(rules)
    dec = load_logged_decisions(journal)
    preds = predictions_from_decisions(dec, cs, spec)
    labs = build_labels(cs, snapshots(cs), spec)
    by_ts = {c.close_ts: i for i, c in enumerate(cs)}
    assert {p.question for p in preds} >= {"quality_up", "quality_down", "direction_up", "direction_down"}
    ups = [p for p in preds if p.question == "quality_up"]
    assert len(ups) > 50
    for p in ups:  # outcome equals the label computed from the candles after the decision
        assert p.y == labs[by_ts[p.ts]]["quality_up"]
    # decisions whose horizon runs past the end of the data are dropped, never half-resolved
    tail = [d for d in dec if by_ts[d.ts] + spec.horizon >= len(cs)]
    assert tail and predictions_from_decisions(tail, cs, spec) == []


def test_trade_predictions_use_tp_and_sl_outcomes_only(run):
    rules, cs, journal, res = run
    dec = load_logged_decisions(journal)
    tp = trade_predictions(dec, res.trades)
    assert len(tp) > 20 and {p.question for p in tp} == {"trade_win"}
    kept = [t for t in res.trades if t.exit_reason in ("tp", "sl")]
    assert len(tp) <= len(kept)
    assert all(0 <= p.p <= 1 and p.y in (0, 1) for p in tp)


def test_fitted_scorer_is_reasonably_calibrated_on_holdout(run):
    rules, cs, journal, res = run
    spec = LabelSpec.from_rules(rules)
    rep = calibration_report(predictions_from_decisions(load_logged_decisions(journal), cs, spec))
    q = rep["quality_up"]
    assert q.n > 100 and q.brier_skill > 0 and q.ece < 0.12
