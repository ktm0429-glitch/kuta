"""
自動学習エンジン — LightGBM モデルの訓練・評価・保存
"""

import json
import logging
import os
import pickle
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import TimeSeriesSplit
from sklearn.metrics import accuracy_score, roc_auc_score

from features import compute_features, FEATURE_COLS

LOG = logging.getLogger(__name__)
DATA_DIR = Path(__file__).parent.parent / "data"
MODEL_DIR = Path(__file__).parent.parent / "models"
MODEL_DIR.mkdir(exist_ok=True)


def load_ohlcv() -> pd.DataFrame:
    """EAが出力したOHLCVのCSVを読み込む"""
    path = DATA_DIR / "ohlcv_H1.csv"
    if not path.exists():
        raise FileNotFoundError(f"OHLCVデータが見つかりません: {path}")
    df = pd.read_csv(path, parse_dates=["time"])
    df.sort_values("time", inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df


def make_labels(df: pd.DataFrame, forward_bars: int = 3, threshold_atr_mult: float = 0.5) -> pd.Series:
    """
    ラベル生成:
      1 = forward_bars後に close が threshold以上上昇
      0 = forward_bars後に close が threshold以上下落
      NaN = どちらでもない (学習から除外)
    """
    future_close = df["close"].shift(-forward_bars)
    atr = df["atr14"] if "atr14" in df.columns else df["close"].rolling(14).std()
    threshold = atr * threshold_atr_mult

    label = pd.Series(np.nan, index=df.index)
    label[future_close - df["close"] > threshold] = 1
    label[df["close"] - future_close > threshold] = 0
    return label


def train() -> dict:
    """
    モデルを学習して保存。学習結果のメトリクスを返す。
    """
    LOG.info("学習開始")

    raw = load_ohlcv()
    df = compute_features(raw)
    df["label"] = make_labels(df)

    # ラベルが確定している行だけ使う
    df.dropna(subset=["label"] + FEATURE_COLS, inplace=True)

    X = df[FEATURE_COLS].values
    y = df["label"].values.astype(int)

    if len(X) < 500:
        raise ValueError(f"学習データが不足しています: {len(X)}行 (最低500行必要)")

    # 時系列分割でCV
    tscv = TimeSeriesSplit(n_splits=5)
    aucs = []

    params = {
        "objective": "binary",
        "metric": "auc",
        "learning_rate": 0.03,
        "num_leaves": 63,
        "max_depth": -1,
        "min_child_samples": 30,
        "feature_fraction": 0.8,
        "bagging_fraction": 0.8,
        "bagging_freq": 5,
        "reg_alpha": 0.1,
        "reg_lambda": 1.0,
        "verbose": -1,
        "n_jobs": -1,
    }

    best_model = None
    best_auc = 0.0

    for fold, (tr_idx, val_idx) in enumerate(tscv.split(X)):
        X_tr, X_val = X[tr_idx], X[val_idx]
        y_tr, y_val = y[tr_idx], y[val_idx]

        dtrain = lgb.Dataset(X_tr, label=y_tr)
        dval = lgb.Dataset(X_val, label=y_val, reference=dtrain)

        model = lgb.train(
            params,
            dtrain,
            num_boost_round=1000,
            valid_sets=[dval],
            callbacks=[lgb.early_stopping(50, verbose=False), lgb.log_evaluation(0)],
        )

        preds = model.predict(X_val)
        auc = roc_auc_score(y_val, preds)
        aucs.append(auc)
        LOG.info(f"Fold {fold+1} AUC: {auc:.4f}")

        if auc > best_auc:
            best_auc = auc
            best_model = model

    mean_auc = float(np.mean(aucs))
    LOG.info(f"平均AUC: {mean_auc:.4f}")

    # モデル保存
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_path = MODEL_DIR / f"model_{ts}.pkl"
    with open(model_path, "wb") as f:
        pickle.dump(best_model, f)

    # 最新モデルへのリンク更新
    latest_path = MODEL_DIR / "model_latest.pkl"
    with open(latest_path, "wb") as f:
        pickle.dump(best_model, f)

    # メトリクス保存
    metrics = {
        "timestamp": ts,
        "mean_auc": mean_auc,
        "fold_aucs": aucs,
        "n_samples": len(X),
        "n_features": len(FEATURE_COLS),
        "model_path": str(model_path),
    }
    with open(MODEL_DIR / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)

    LOG.info(f"モデル保存完了: {model_path}")
    return metrics


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    result = train()
    print(json.dumps(result, indent=2))
