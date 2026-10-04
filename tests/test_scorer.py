import math
import random
import time
from datetime import datetime, timedelta, timezone

import pytest

from xbot.models import Candle
from xbot.scorer import (DIRECTIONS, REGIMES, RISK_STATES, JevScorer, LocalScorer, ScoreError, Scores,
                         ValidatingScorer)
from xbot.state import Snapshot, StateEngine

T0 = datetime(2026, 1, 5, tzinfo=timezone.utc)


def snap(**kw):
    d = dict(ts=T0, price=2000.0, spread_points=20.0, imbalance=0.0, realized_vol=0.0004, trend=0.0, flow=0.0)
    d.update(kw)
    return Snapshot(**d)


def good():
    return dict(
        regime={r: 1 / 3 for r in REGIMES}, direction={d: 1 / 3 for d in DIRECTIONS}, pressure_real=0.5,
        setup_quality={"up": 0.5, "down": 0.5}, risk_state={s: 1 / 3 for s in RISK_STATES},
    )


# ---- schema ----------------------------------------------------------------
def test_valid_scores_pass():
    Scores(**good()).validate()


@pytest.mark.parametrize(
    "patch",
    [
        dict(direction={"up": 0.5, "down": 0.5, "none": 0.5}),     # sums to 1.5
        dict(direction={"up": 0.5, "down": 0.5}),                  # missing key
        dict(direction={"up": 1.2, "down": -0.2, "none": 0.0}),    # out of range
        dict(pressure_real=1.1),
        dict(pressure_real=float("nan")),
        dict(setup_quality={"up": 0.5}),
        dict(setup_quality={"up": 0.5, "down": 2.0}),
        dict(risk_state={"normal": 0.5, "elevated": 0.5, "halt": 0.5}),
        dict(regime={"trending": 1.0, "ranging": 0.0, "volatile": 0.0, "extra": 0.0}),
    ],
)
def test_invalid_scores_rejected(patch):
    with pytest.raises(ScoreError):
        Scores(**{**good(), **patch}).validate()


def test_validating_wrapper_catches_bad_external_scorer():
    class Bad:
        def score(self, s):
            return Scores(**{**good(), "pressure_real": 3.0})
    with pytest.raises(ScoreError):
        ValidatingScorer(Bad()).score(snap())


def test_jev_stub_fails_loudly_not_silently():
    with pytest.raises(NotImplementedError, match="Jev"):
        JevScorer().score(snap())


# ---- neutral / heuristics ----------------------------------------------------
def test_neutral_scorer_is_valid_and_deterministic():
    sc = LocalScorer.neutral()
    a, b = sc.score(snap()), sc.score(snap())
    assert a == b
    a.validate()


def test_high_vol_shifts_regime_and_risk():
    sc = LocalScorer.neutral()
    calm, wild = sc.score(snap(realized_vol=0.0003)), sc.score(snap(realized_vol=0.003))
    assert wild.regime["volatile"] > calm.regime["volatile"]
    assert wild.risk_state["halt"] > calm.risk_state["halt"]
    assert max(calm.risk_state, key=calm.risk_state.get) == "normal"


def test_strong_trend_raises_trending_probability():
    sc = LocalScorer.neutral()
    flat, trend = sc.score(snap(trend=0.0)), sc.score(snap(trend=0.0006))
    assert trend.regime["trending"] > flat.regime["trending"]


def test_scoring_latency_is_tiny():
    sc, s = LocalScorer.neutral(), snap(flow=0.4, imbalance=0.2, trend=0.0002)
    t = time.perf_counter()
    for _ in range(2000):
        sc.score(s)
    assert (time.perf_counter() - t) / 2000 < 0.005  # well under the 100 ms budget


# ---- training on planted signal ---------------------------------------------
np = pytest.importorskip("numpy")
from xbot.labels import LabelSpec, build_labels  # noqa: E402

SPEC = LabelSpec(horizon=24, stop_vol_mult=4.0, r_multiple=1.5, min_stop_points=300, move_vol_mult=1.0)


def planted(n, seed):
    """Hidden persistent drift state s=+-1; volume is higher on candles that agree with s."""
    rnd, px, s, out, states = random.Random(seed), 2000.0, 1, [], []
    for i in range(n):
        if rnd.random() > 0.98:
            s = -s
        ret = s * 0.35 + rnd.gauss(0, 0.8)
        o, c = px, px + ret
        vol = 100 + 50 * s * (1 if ret > 0 else -1) + rnd.gauss(0, 10)
        out.append(Candle(T0 + timedelta(minutes=5 * i), o, max(o, c) + abs(rnd.gauss(0, .2)),
                          min(o, c) - abs(rnd.gauss(0, .2)), c, max(vol, 1), 20, 300))
        states.append(s)
        px = c
    return out, states


def snapshots(candles):
    eng = StateEngine()
    return [eng.snapshot(candles[max(0, i + 1 - eng.min_candles): i + 1], c.close_ts) if i + 1 >= eng.min_candles else None
            for i, c in enumerate(candles)]


def test_labels_use_only_the_horizon_and_mask_the_tail():
    cs, _ = planted(300, 1)
    snaps = snapshots(cs)
    base = build_labels(cs, snaps, SPEC)
    assert all(base[i] is None for i in range(len(cs) - SPEC.horizon, len(cs)))
    k = 100
    cs2 = cs[: k + SPEC.horizon + 1] + [
        Candle(c.ts, c.open * 1.5, c.high * 1.5, c.low * 1.5, c.close * 1.5, c.tick_volume, c.spread_points, 300)
        for c in cs[k + SPEC.horizon + 1:]
    ]
    changed = build_labels(cs2, snapshots(cs2), SPEC)
    assert base[k] == changed[k]  # bars after k+horizon cannot influence label k


def test_quality_label_known_answers():
    # flat then a rally: long wins (+1.5R), short loses
    flat = [Candle(T0 + timedelta(minutes=5 * i), 2000, 2000.3, 1999.7, 2000, 100, 20, 300) for i in range(30)]
    rally = [Candle(T0 + timedelta(minutes=5 * (30 + i)), 2000 + 2 * i, 2000 + 2 * i + 2.5, 2000 + 2 * i - .1,
                    2000 + 2 * i + 2, 100, 20, 300) for i in range(40)]
    cs = flat + rally
    lab = build_labels(cs, snapshots(cs), SPEC)[28]
    assert lab["quality_up"] == 1 and lab["quality_down"] == 0


def test_fit_learns_planted_signal_out_of_sample():
    cs, states = planted(24_000, 5)
    train, test = cs[:14_000], cs[14_000:]
    sc = LocalScorer.fit(train, SPEC)
    snaps, labs = snapshots(test), build_labels(test, snapshots(test), SPEC)
    up_p, dn_p = [], []
    for i, sn in enumerate(snaps):
        if sn is None:
            continue
        p = sc.score(sn).direction["up"]
        (up_p if states[14_000 + i] > 0 else dn_p).append(p)
    assert sum(up_p) / len(up_p) - sum(dn_p) / len(dn_p) > 0.05

    # setup quality beats a constant base-rate predictor on held-out Brier score
    ys, ps, base_rate = [], [], None
    tr_labs = [l for l in build_labels(train, snapshots(train), SPEC) if l]
    base_rate = sum(l["quality_up"] + l["quality_down"] for l in tr_labs) / (2 * len(tr_labs))
    for sn, lab in zip(snaps, labs):
        if sn is None or lab is None:
            continue
        q = sc.score(sn).setup_quality
        ys += [lab["quality_up"], lab["quality_down"]]
        ps += [q["up"], q["down"]]
    brier = sum((p - y) ** 2 for p, y in zip(ps, ys)) / len(ys)
    brier_const = sum((base_rate - y) ** 2 for y in ys) / len(ys)
    assert brier < brier_const


def test_fitted_scores_are_valid_and_roundtrip_through_json(tmp_path):
    cs, _ = planted(6_000, 2)
    sc = LocalScorer.fit(cs, SPEC)
    path = tmp_path / "scorer.json"
    sc.save(path)
    again = LocalScorer.load(path)
    s = snapshots(cs)[3000]
    assert sc.score(s) == again.score(s)
    sc.score(s).validate()


def test_fit_rejects_too_little_data():
    cs, _ = planted(100, 3)
    with pytest.raises(ValueError):
        LocalScorer.fit(cs, SPEC)
