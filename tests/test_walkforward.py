from datetime import datetime, timedelta, timezone

import pytest

from xbot.backtest import CostModel
from xbot.models import Candle
from xbot.walkforward import make_folds, run_walk_forward

T0 = datetime(2026, 1, 5, tzinfo=timezone.utc)
TF = 300


def candles(n):
    return [Candle(T0 + timedelta(seconds=TF * i), 2000, 2000, 2000, 2000, 100, 20, TF) for i in range(n)]


def test_folds_are_contiguous_non_overlapping_and_after_train():
    folds = make_folds(1000, n_folds=3, initial_train_frac=0.4, embargo=10)
    assert folds[0].test_start == 400 and folds[-1].test_end == 1000
    for a, b in zip(folds, folds[1:]):
        assert a.test_end == b.test_start
    for f in folds:
        assert f.train_end == f.test_start - 10 and f.train_end > 0 and f.test_end > f.test_start


def test_folds_expanding_training_window():
    folds = make_folds(1000, 3, 0.4, 0)
    assert [f.train_end for f in folds] == sorted(f.train_end for f in folds)
    assert folds[0].train_end < folds[-1].train_end


def test_invalid_args():
    with pytest.raises(ValueError):
        make_folds(100, 0, 0.4, 0)
    with pytest.raises(ValueError):
        make_folds(100, 3, 1.2, 0)


def test_fit_sees_only_training_data(cfg):
    cs = candles(600)
    seen = []

    def fit(train):
        seen.append(train[-1].close_ts)
        return lambda snap, ctx: None

    run_walk_forward(cs, fit, cfg, n_folds=3, initial_train_frac=0.4, embargo=5, costs=CostModel(0))
    folds = make_folds(600, 3, 0.4, 5)
    assert len(seen) == 3
    for s, f in zip(seen, folds):
        assert s == cs[f.train_end - 1].close_ts


def test_oos_results_cover_only_test_segments(cfg):
    cs = candles(600)
    res = run_walk_forward(cs, lambda train: (lambda snap, ctx: None), cfg, 3, 0.4, 5, CostModel(0))
    assert len(res.folds) == 3
    assert res.combined.equity[0].ts >= cs[240].close_ts
    assert len(res.combined.equity) == 600 - 240
