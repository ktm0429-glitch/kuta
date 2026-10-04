"""Calibration: are the scorer's probabilities honest? Measure, gate sizing on it, and repair if the curve bends.

Measured per question on data the scorer was NOT trained on, ideally the venue's own (TitanFX) prices:
  Brier score, Brier skill vs the base rate, reliability curve, ECE, and logistic slope/intercept (1 / 0 = perfect).
Questions with an objective outcome: direction_up/down, pressure_real, quality_up/down; plus "trade_win"
for the bot's own filled trades (take-profit before stop-loss). regime / risk_state are heuristics with no
objective label and are not calibrated here.
Sizing may leave "probe size" only when check_calibration(...).ok is true.
"""
from __future__ import annotations

import bisect
import json
import math
from dataclasses import asdict, dataclass, field
from datetime import datetime

from .journal import Journal
from .labels import LabelSpec, label_at
from .scorer import DIRECTIONS, Scores

EPS = 1e-6
SIZING_QUESTIONS = ("quality_up", "quality_down")


@dataclass(frozen=True)
class Prediction:
    question: str
    p: float
    y: int
    ts: datetime | None = None


@dataclass(frozen=True)
class Bin:
    lo: float
    hi: float
    n: int
    mean_p: float
    freq: float


def brier_score(ps, ys) -> float:
    if len(ps) != len(ys):
        raise ValueError("length mismatch")
    return sum((p - y) ** 2 for p, y in zip(ps, ys)) / len(ps) if ps else 0.0


def reliability_curve(ps, ys, n_bins: int = 10) -> list[Bin]:
    buckets: list[list[tuple[float, int]]] = [[] for _ in range(n_bins)]
    for p, y in zip(ps, ys):
        buckets[min(int(p * n_bins), n_bins - 1)].append((p, y))
    return [
        Bin(k / n_bins, (k + 1) / n_bins, len(b), sum(p for p, _ in b) / len(b), sum(y for _, y in b) / len(b))
        for k, b in enumerate(buckets) if b
    ]


def ece(ps, ys, n_bins: int = 10) -> float:
    n = len(ps)
    return sum(b.n / n * abs(b.mean_p - b.freq) for b in reliability_curve(ps, ys, n_bins)) if n else 0.0


def _logit(p: float) -> float:
    p = min(max(p, EPS), 1 - EPS)
    return math.log(p / (1 - p))


def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x)) if x >= 0 else math.exp(x) / (1 + math.exp(x))


# --- recalibrators -------------------------------------------------------------
@dataclass(frozen=True)
class Platt:
    a: float = 1.0
    b: float = 0.0

    def apply(self, p: float) -> float:
        return min(max(_sigmoid(self.a * _logit(p) + self.b), EPS), 1 - EPS)


def fit_platt(ps, ys, iters: int = 50) -> Platt:
    """Logistic regression of y on logit(p) by Newton's method; identity on degenerate data."""
    if len(ps) < 2 or len(set(ys)) < 2:
        return Platt()
    zs = [_logit(p) for p in ps]
    a, b = 1.0, 0.0
    for _ in range(iters):
        g_a = g_b = h_aa = h_ab = h_bb = 0.0
        for z, y in zip(zs, ys):
            q = _sigmoid(a * z + b)
            w = q * (1 - q)
            g_a += (q - y) * z; g_b += (q - y)
            h_aa += w * z * z; h_ab += w * z; h_bb += w
        h_aa += 1e-9; h_bb += 1e-9
        det = h_aa * h_bb - h_ab * h_ab
        if abs(det) < 1e-12:
            break
        da, db = (h_bb * g_a - h_ab * g_b) / det, (h_aa * g_b - h_ab * g_a) / det
        a, b = a - da, b - db
        if abs(da) + abs(db) < 1e-9:
            break
    return Platt(a, b)


@dataclass(frozen=True)
class Isotonic:
    xs: tuple[float, ...]
    ys: tuple[float, ...]

    def apply(self, p: float) -> float:
        if not self.xs:
            return p
        if p <= self.xs[0]:
            v = self.ys[0]
        elif p >= self.xs[-1]:
            v = self.ys[-1]
        else:
            k = bisect.bisect_right(self.xs, p)
            x0, x1, y0, y1 = self.xs[k - 1], self.xs[k], self.ys[k - 1], self.ys[k]
            v = y0 if x1 == x0 else y0 + (y1 - y0) * (p - x0) / (x1 - x0)
        return min(max(v, 0.001), 0.999)


def fit_isotonic(ps, ys) -> Isotonic:
    """Pool-adjacent-violators: monotone non-decreasing map from predicted to observed frequency."""
    if not ps:
        return Isotonic((), ())
    pairs = sorted(zip(ps, ys))
    blocks = []  # [sum_y, count, sum_p]
    for p, y in pairs:
        blocks.append([float(y), 1, p])
        while len(blocks) > 1 and blocks[-2][0] / blocks[-2][1] > blocks[-1][0] / blocks[-1][1]:
            s, c, sp = blocks.pop()
            blocks[-1][0] += s; blocks[-1][1] += c; blocks[-1][2] += sp
    xs = [b[2] / b[1] for b in blocks]
    ys_ = [b[0] / b[1] for b in blocks]
    keep = [0] + [k for k in range(1, len(xs)) if xs[k] > xs[k - 1]]
    return Isotonic(tuple(xs[k] for k in keep), tuple(ys_[k] for k in keep))


def recalibrators_from(preds: list[Prediction], method: str = "platt", min_samples: int = 200) -> dict:
    by_q: dict[str, list[Prediction]] = {}
    for p in preds:
        by_q.setdefault(p.question, []).append(p)
    out = {}
    for q, items in by_q.items():
        if len(items) < min_samples or q == "trade_win":
            continue
        ps, ys = [i.p for i in items], [i.y for i in items]
        out[q] = fit_platt(ps, ys) if method == "platt" else fit_isotonic(ps, ys)
    return out


class CalibratedScorer:
    """Applies per-question recalibrators to any scorer's output. Missing recalibrator => passthrough."""

    def __init__(self, inner, recalibrators: dict):
        self.inner, self.rec = inner, recalibrators

    def _adj(self, key: str, p: float) -> float:
        r = self.rec.get(key)
        return r.apply(p) if r else p

    def score(self, snap) -> Scores:
        s = self.inner.score(snap)
        direction = s.direction  # untouched unless a direction recalibrator exists
        if "direction_up" in self.rec or "direction_down" in self.rec:
            up, down = self._adj("direction_up", s.direction["up"]), self._adj("direction_down", s.direction["down"])
            if up + down > 1:
                up, down = up / (up + down), down / (up + down)
            direction = {"up": up, "down": down, "none": max(0.0, 1.0 - up - down)}
        return Scores(
            regime=s.regime,
            direction=direction,
            pressure_real=self._adj("pressure_real", s.pressure_real),
            setup_quality={"up": self._adj("quality_up", s.setup_quality["up"]),
                           "down": self._adj("quality_down", s.setup_quality["down"])},
            risk_state=s.risk_state,
        )


# --- reports and the sizing gate -------------------------------------------------
@dataclass(frozen=True)
class QuestionReport:
    n: int
    base_rate: float
    mean_p: float
    brier: float
    brier_skill: float   # 1 - brier / brier(base rate); > 0 means better than a constant
    ece: float
    slope: float         # logistic recalibration slope: ~1 calibrated, <1 overconfident, >1 underconfident
    intercept: float
    curve: list[Bin] = field(default_factory=list)


def question_report(preds: list[Prediction]) -> QuestionReport:
    ps, ys = [p.p for p in preds], [p.y for p in preds]
    n = len(ps)
    base = sum(ys) / n
    brier = brier_score(ps, ys)
    ref = brier_score([base] * n, ys)
    platt = fit_platt(ps, ys)
    return QuestionReport(n, base, sum(ps) / n, brier, (1 - brier / ref) if ref > 0 else 0.0,
                          ece(ps, ys), platt.a, platt.b, reliability_curve(ps, ys))


def calibration_report(preds: list[Prediction]) -> dict[str, QuestionReport]:
    by_q: dict[str, list[Prediction]] = {}
    for p in preds:
        by_q.setdefault(p.question, []).append(p)
    return {q: question_report(v) for q, v in sorted(by_q.items())}


@dataclass(frozen=True)
class CalibrationThresholds:
    min_samples: int = 300
    max_ece: float = 0.05
    slope_lo: float = 0.8
    slope_hi: float = 1.2
    min_skill: float = 0.0
    min_trades: int = 30
    max_trade_z: float = 2.0


@dataclass(frozen=True)
class CalibrationStatus:
    ok: bool
    reasons: list[str]


def check_calibration(report: dict[str, QuestionReport], trade_preds: list[Prediction],
                      th: CalibrationThresholds = CalibrationThresholds()) -> CalibrationStatus:
    reasons = []
    for q in SIZING_QUESTIONS:
        r = report.get(q)
        if r is None or r.n < th.min_samples:
            reasons.append(f"{q}: not enough samples ({0 if r is None else r.n} < {th.min_samples})")
            continue
        if r.ece > th.max_ece:
            reasons.append(f"{q}: ECE {r.ece:.3f} > {th.max_ece}")
        if not th.slope_lo <= r.slope <= th.slope_hi:
            reasons.append(f"{q}: slope {r.slope:.2f} outside [{th.slope_lo}, {th.slope_hi}]")
        if r.brier_skill <= th.min_skill:
            reasons.append(f"{q}: no skill over base rate ({r.brier_skill:.3f})")
    if len(trade_preds) < th.min_trades:
        reasons.append(f"own fills: only {len(trade_preds)} < {th.min_trades} resolved trades")
    else:
        exp = sum(t.p for t in trade_preds)
        var = sum(t.p * (1 - t.p) for t in trade_preds)
        z = (sum(t.y for t in trade_preds) - exp) / math.sqrt(var) if var > 0 else 0.0
        if abs(z) > th.max_trade_z:
            reasons.append(f"own fills: win rate {sum(t.y for t in trade_preds)}/{len(trade_preds)} vs expected {exp:.1f} (z={z:.1f})")
    return CalibrationStatus(not reasons, reasons)


# --- logging decisions and resolving outcomes ------------------------------------------
@dataclass(frozen=True)
class LoggedDecision:
    ts: datetime
    scores: Scores
    action: str
    p_win: float
    lots: float


def journal_sink(journal: Journal):
    """DecisionRecord sink for Brain: logs EVERY scored bar (traded or not) so calibration has no selection bias."""
    def sink(rec) -> None:
        journal.log("decision", {
            "ts": rec.snapshot.ts.isoformat(),
            "scores": asdict(rec.scores),
            "action": rec.decision.action.value,
            "p_win": rec.decision.p_win,
            "lots": rec.size.lots if rec.size else 0.0,
        }, rec.ts)
    return sink


def load_logged_decisions(journal: Journal) -> list[LoggedDecision]:
    out = []
    for e in journal.events("decision"):
        p = e["payload"]
        out.append(LoggedDecision(datetime.fromisoformat(p["ts"]), Scores(**p["scores"]), p["action"], p["p_win"], p["lots"]))
    return out


def predictions_from_decisions(decisions: list[LoggedDecision], candles, spec: LabelSpec) -> list[Prediction]:
    """Resolve outcomes from the candles AFTER each decision; decisions without a full horizon are dropped."""
    idx = {c.close_ts: i for i, c in enumerate(candles)}
    out = []
    for d in decisions:
        i = idx.get(d.ts)
        if i is None:
            continue
        s = _snap_for_label(candles, i)
        lab = label_at(candles, i, s, spec)
        if lab is None:
            continue
        sc = d.scores
        out += [
            Prediction("direction_up", sc.direction["up"], int(lab["direction"] == 0), d.ts),
            Prediction("direction_down", sc.direction["down"], int(lab["direction"] == 1), d.ts),
            Prediction("quality_up", sc.setup_quality["up"], lab["quality_up"], d.ts),
            Prediction("quality_down", sc.setup_quality["down"], lab["quality_down"], d.ts),
        ]
        if lab["pressure"] is not None:
            out.append(Prediction("pressure_real", sc.pressure_real, lab["pressure"], d.ts))
    return out


def _snap_for_label(candles, i):
    from .state import StateEngine
    eng = StateEngine()
    if i + 1 < eng.min_candles:
        return None
    return eng.snapshot(candles[i + 1 - eng.min_candles: i + 1], candles[i].close_ts)


def trade_predictions(decisions: list[LoggedDecision], trades) -> list[Prediction]:
    """The bot's own fills: p_win at decision time vs whether the take-profit was hit before the stop."""
    by_ts = {d.ts: d for d in decisions}
    out = []
    for t in trades:
        if t.exit_reason not in ("tp", "sl") or t.snapshot is None:
            continue
        d = by_ts.get(t.snapshot.ts)
        if d is not None and d.p_win > 0:
            out.append(Prediction("trade_win", d.p_win, int(t.exit_reason == "tp"), d.ts))
    return out
