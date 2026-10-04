"""Fast reflex layer: calibrated probabilities for FIXED-OUTCOME questions, no text, sub-millisecond.

Questions:  regime (choice), direction (choice), pressure_real (yes/no), setup_quality (score per side),
risk_state (choice). Each isolates one factor so the code can combine them with explicit weights.

LocalScorer v1: direction, pressure_real and setup_quality are LEARNED (softmax / logistic regression
on standardized snapshot features); regime and risk_state are transparent heuristics on volatility and
trend strength (parameters stored in the JSON, not learned). JevScorer is a placeholder for the real SDK.
Inference is pure Python; numpy is needed only for fit().
"""
from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .labels import LabelSpec, build_labels
from .models import Candle
from .state import Snapshot, StateEngine

REGIMES = ("trending", "ranging", "volatile")
DIRECTIONS = ("up", "down", "none")
RISK_STATES = ("normal", "elevated", "halt")
SIDES = ("up", "down")


class ScoreError(ValueError):
    pass


@dataclass(frozen=True)
class Scores:
    regime: dict[str, float]
    direction: dict[str, float]
    pressure_real: float
    setup_quality: dict[str, float]
    risk_state: dict[str, float]

    def validate(self) -> "Scores":
        def dist(name, d, keys, must_sum):
            if set(d) != set(keys):
                raise ScoreError(f"{name}: keys must be {keys}, got {sorted(d)}")
            for k, v in d.items():
                if not (isinstance(v, (int, float)) and math.isfinite(v) and 0.0 <= v <= 1.0):
                    raise ScoreError(f"{name}.{k}: {v!r} not a probability")
            if must_sum and abs(sum(d.values()) - 1.0) > 1e-6:
                raise ScoreError(f"{name}: probabilities sum to {sum(d.values())}")

        dist("regime", self.regime, REGIMES, True)
        dist("direction", self.direction, DIRECTIONS, True)
        dist("risk_state", self.risk_state, RISK_STATES, True)
        dist("setup_quality", self.setup_quality, SIDES, False)
        dist("pressure_real", {"p": self.pressure_real}, ("p",), False)
        return self


class Scorer(Protocol):
    def score(self, snap: Snapshot) -> Scores: ...


class ValidatingScorer:
    """Wrap ANY scorer (including an external one) so malformed output can never reach the decision code."""

    def __init__(self, inner: Scorer):
        self.inner = inner

    def score(self, snap: Snapshot) -> Scores:
        return self.inner.score(snap).validate()


class JevScorer:
    """Placeholder for the Jev SDK. Not available yet: fails loudly instead of returning fake numbers."""

    def score(self, snap: Snapshot) -> Scores:
        raise NotImplementedError("Jev SDK is not integrated: supply its package name and docs first")


# --- math helpers -----------------------------------------------------------
def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x)) if x >= 0 else math.exp(x) / (1 + math.exp(x))


def _softmax(logits: list[float]) -> list[float]:
    m = max(logits)
    e = [math.exp(x - m) for x in logits]
    t = sum(e)
    return [x / t for x in e]


def _clip(x: float, lo: float, hi: float) -> float:
    return lo if x < lo else hi if x > hi else x


def _sgn(x: float) -> float:
    return (x > 0) - (x < 0)


# --- features ---------------------------------------------------------------
def _common(s: Snapshot, p: dict) -> tuple[float, float, float]:
    vol = max(s.realized_vol, 1e-9)
    vol_z = _clip((math.log(vol) - p["log_vol_mean"]) / p["log_vol_std"], -6, 6)
    trend_z = _clip(s.trend / vol, -3, 3)
    spread_ratio = _clip(s.spread_points * 0.01 / (vol * s.price + 1e-9), 0, 5)
    return vol_z, trend_z, spread_ratio


def _f_dir(s: Snapshot, p: dict) -> list[float]:
    vz, tz, sr = _common(s, p)
    return [s.imbalance, s.flow, tz, vz, sr]


def _f_quality(s: Snapshot, p: dict, d: int) -> list[float]:
    vz, tz, sr = _common(s, p)
    return [d * s.imbalance, d * s.flow, d * tz, vz, sr]


def _f_pressure(s: Snapshot, p: dict) -> list[float]:
    vz, tz, sr = _common(s, p)
    return [abs(s.flow), abs(s.imbalance), _sgn(s.flow) * _sgn(s.imbalance), _sgn(s.flow) * _sgn(s.trend), vz, sr]


def _std(x: list[float], mean: list[float], std: list[float]) -> list[float]:
    return [(a - m) / sd for a, m, sd in zip(x, mean, std)]


def _dot(w: list[float], x: list[float]) -> float:
    return w[0] + sum(a * b for a, b in zip(w[1:], x))  # w[0] is the bias


NEUTRAL = {
    "version": 1,
    "log_vol_mean": math.log(4e-4),
    "log_vol_std": 0.4,
    "dir": {"mean": [0.0] * 5, "std": [1.0] * 5, "W": [[0.0] * 6 for _ in DIRECTIONS]},
    "quality": {"mean": [0.0] * 5, "std": [1.0] * 5, "w": [0.0] * 6},
    "pressure": {"mean": [0.0] * 6, "std": [1.0] * 6, "w": [0.0] * 7},
    "heur": {"reg_a": 4.0, "reg_s0": 0.5, "reg_b": 2.0, "reg_v0": 1.5,
             "risk_c": 2.0, "risk_e0": 1.0, "risk_d": 3.0, "risk_h0": 2.5, "risk_g": 1.0, "risk_sr0": 1.5},
}


class LocalScorer:
    def __init__(self, params: dict):
        self.p = params

    @classmethod
    def neutral(cls) -> "LocalScorer":
        return cls(json.loads(json.dumps(NEUTRAL)))

    # --- inference -----------------------------------------------------------
    def score(self, s: Snapshot) -> Scores:
        p, h = self.p, self.p["heur"]
        vz, tz, sr = _common(s, p)
        strength = _clip(abs(s.trend) / max(s.realized_vol, 1e-9), 0, 5)

        d = p["dir"]
        x = _std(_f_dir(s, p), d["mean"], d["std"])
        direction = dict(zip(DIRECTIONS, _softmax([_dot(w, x) for w in d["W"]])))

        q = p["quality"]
        quality = {
            side: _sigmoid(_dot(q["w"], _std(_f_quality(s, p, sign), q["mean"], q["std"])))
            for side, sign in (("up", 1), ("down", -1))
        }
        pr = p["pressure"]
        pressure = _sigmoid(_dot(pr["w"], _std(_f_pressure(s, p), pr["mean"], pr["std"])))

        regime = dict(zip(REGIMES, _softmax([h["reg_a"] * (strength - h["reg_s0"]), 0.0, h["reg_b"] * (vz - h["reg_v0"])])))
        risk = dict(zip(RISK_STATES, _softmax([
            0.0,
            h["risk_c"] * (vz - h["risk_e0"]) + h["risk_g"] * (sr - h["risk_sr0"]),
            h["risk_d"] * (vz - h["risk_h0"]) + h["risk_g"] * (sr - 2 * h["risk_sr0"]),
        ])))
        return Scores(regime, direction, pressure, quality, risk)

    # --- persistence ---------------------------------------------------------
    def save(self, path: str | Path) -> None:
        Path(path).write_text(json.dumps(self.p, indent=1))

    @classmethod
    def load(cls, path: str | Path) -> "LocalScorer":
        return cls(json.loads(Path(path).read_text()))

    # --- training (numpy) ------------------------------------------------------
    @classmethod
    def fit(cls, candles: list[Candle], spec: LabelSpec, l2: float = 1.0, iters: int = 400,
            lr: float = 0.5, min_samples: int = 1000) -> "LocalScorer":
        import numpy as np

        eng = StateEngine()
        need = eng.min_candles
        snaps = [eng.snapshot(candles[i + 1 - need: i + 1], c.close_ts) if i + 1 >= need else None
                 for i, c in enumerate(candles)]
        labels = build_labels(candles, snaps, spec)
        rows = [(s, l) for s, l in zip(snaps, labels) if s is not None and l is not None]
        if len(rows) < min_samples:
            raise ValueError(f"need >= {min_samples} labelled samples, got {len(rows)}")

        params = json.loads(json.dumps(NEUTRAL))
        logv = np.log(np.maximum([s.realized_vol for s, _ in rows], 1e-9))
        params["log_vol_mean"], params["log_vol_std"] = float(logv.mean()), float(max(logv.std(), 1e-3))

        def standardize(X):
            mean, std = X.mean(axis=0), X.std(axis=0)
            std = np.where(std < 1e-9, 1.0, std)
            return (X - mean) / std, mean.tolist(), std.tolist()

        def with_bias(X):
            return np.hstack([np.ones((len(X), 1)), X])

        def fit_softmax(X, y, k):
            Xb, Y = with_bias(X), np.eye(k)[y]
            W = np.zeros((k, Xb.shape[1]))
            reg = np.ones_like(W); reg[:, 0] = 0
            for _ in range(iters):
                Z = Xb @ W.T
                Z -= Z.max(axis=1, keepdims=True)
                P = np.exp(Z); P /= P.sum(axis=1, keepdims=True)
                W -= lr * ((P - Y).T @ Xb / len(Xb) + l2 / len(Xb) * reg * W)
            return W

        def fit_logistic(X, y):
            Xb = with_bias(X)
            w = np.zeros(Xb.shape[1])
            reg = np.ones_like(w); reg[0] = 0
            for _ in range(iters):
                p = 1 / (1 + np.exp(-(Xb @ w)))
                w -= lr * (Xb.T @ (p - y) / len(Xb) + l2 / len(Xb) * reg * w)
            return w

        Xd = np.array([_f_dir(s, params) for s, _ in rows])
        Xd, m, sd = standardize(Xd)
        params["dir"] = {"mean": m, "std": sd, "W": fit_softmax(Xd, np.array([l["direction"] for _, l in rows]), 3).tolist()}

        Xq = np.array([_f_quality(s, params, d) for s, _ in rows for d in (1, -1)])
        yq = np.array([l[k] for _, l in rows for k in ("quality_up", "quality_down")], dtype=float)
        Xq, m, sd = standardize(Xq)
        params["quality"] = {"mean": m, "std": sd, "w": fit_logistic(Xq, yq).tolist()}

        pr_rows = [(s, l["pressure"]) for s, l in rows if l["pressure"] is not None]
        if len(pr_rows) >= min_samples // 2:
            Xp = np.array([_f_pressure(s, params) for s, _ in pr_rows])
            Xp, m, sd = standardize(Xp)
            params["pressure"] = {"mean": m, "std": sd, "w": fit_logistic(Xp, np.array([y for _, y in pr_rows], dtype=float)).tolist()}
        return cls(params)
