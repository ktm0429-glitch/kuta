"""
ML推論サーバー — EAからHTTPでシグナルを受け取り、BUY/SELL/HOLDを返す
ポート: 5000
"""

import json
import logging
import pickle
import threading
from pathlib import Path

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request

from features import compute_features, FEATURE_COLS

LOG = logging.getLogger(__name__)
MODEL_DIR = Path(__file__).parent.parent / "models"

app = Flask(__name__)

# スレッドセーフなモデルホルダー
_model = None
_model_lock = threading.Lock()


def load_latest_model():
    global _model
    path = MODEL_DIR / "model_latest.pkl"
    if not path.exists():
        LOG.warning("モデルファイルが見つかりません。学習を先に実行してください。")
        return False
    with open(path, "rb") as f:
        new_model = pickle.load(f)
    with _model_lock:
        _model = new_model
    LOG.info(f"モデルをロードしました: {path}")
    return True


@app.route("/health", methods=["GET"])
def health():
    with _model_lock:
        loaded = _model is not None
    return jsonify({"status": "ok", "model_loaded": loaded})


@app.route("/reload", methods=["POST"])
def reload_model():
    """新モデル学習後にEAまたはスケジューラーから呼ぶ"""
    ok = load_latest_model()
    return jsonify({"reloaded": ok})


@app.route("/predict", methods=["POST"])
def predict():
    """
    リクエスト: JSON配列 (最新バーから古い順で200本以上)
    [{"time":"2024-01-01 10:00","open":2000.0,"high":2005.0,"low":1998.0,"close":2003.0,"tick_volume":1234}, ...]

    レスポンス:
    {"signal": "BUY"|"SELL"|"HOLD", "prob_buy": 0.72, "prob_sell": 0.18}
    """
    with _model_lock:
        model = _model

    if model is None:
        return jsonify({"error": "モデル未ロード"}), 503

    try:
        bars = request.get_json(force=True)
        if not bars or len(bars) < 210:
            return jsonify({"error": f"バーが不足しています: {len(bars) if bars else 0}本 (最低210本必要)"}), 400

        df = pd.DataFrame(bars)
        df["time"] = pd.to_datetime(df["time"])
        df.sort_values("time", inplace=True)
        df.reset_index(drop=True, inplace=True)

        df_feat = compute_features(df)
        if df_feat.empty:
            return jsonify({"error": "特徴量計算に失敗しました"}), 500

        # 最新バーの特徴量で推論
        last = df_feat[FEATURE_COLS].iloc[[-1]].values
        prob_up = float(model.predict(last)[0])
        prob_down = 1.0 - prob_up

        # シグナル閾値 (デフォルト 60%)
        threshold = float(request.args.get("threshold", 0.60))

        if prob_up >= threshold:
            signal = "BUY"
        elif prob_down >= threshold:
            signal = "SELL"
        else:
            signal = "HOLD"

        return jsonify({
            "signal": signal,
            "prob_buy": round(prob_up, 4),
            "prob_sell": round(prob_down, 4),
        })

    except Exception as e:
        LOG.exception("推論エラー")
        return jsonify({"error": str(e)}), 500


@app.route("/report_trade", methods=["POST"])
def report_trade():
    """
    EAが取引完了後に損益を報告する。CSVに追記して再学習トリガーに使う。
    {"symbol":"XAUUSD","direction":"BUY","open_price":2000.0,"close_price":2015.0,
     "lots":0.1,"open_time":"...","close_time":"...","profit":150.0}
    """
    import csv
    from datetime import datetime

    data = request.get_json(force=True)
    data["reported_at"] = datetime.now().isoformat()

    trades_path = Path(__file__).parent.parent / "data" / "trades.csv"
    write_header = not trades_path.exists()

    with open(trades_path, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(data.keys()))
        if write_header:
            w.writeheader()
        w.writerow(data)

    return jsonify({"recorded": True})


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(Path(__file__).parent.parent / "data" / "server.log"),
        ],
    )

    load_latest_model()
    LOG.info("ML推論サーバー起動 — http://localhost:5000")
    app.run(host="127.0.0.1", port=5000, threaded=True)
