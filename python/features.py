"""
特徴量エンジニアリング — XAUUSD専用
EAから受け取ったOHLCVデータを学習・推論用の特徴量に変換する
"""

import numpy as np
import pandas as pd


def compute_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    OHLCVデータフレームから特徴量を生成する。
    入力カラム: time, open, high, low, close, tick_volume
    """
    d = df.copy()
    c = d["close"]
    h = d["high"]
    lo = d["low"]
    o = d["open"]
    v = d["tick_volume"]

    # --- ローソク足の形状 ---
    d["body"] = c - o
    d["body_pct"] = d["body"] / o
    d["upper_wick"] = h - d[["open", "close"]].max(axis=1)
    d["lower_wick"] = d[["open", "close"]].min(axis=1) - lo
    d["range"] = h - lo
    d["range_pct"] = d["range"] / o

    # --- 移動平均 ---
    for n in [5, 10, 20, 50, 100, 200]:
        d[f"ma{n}"] = c.rolling(n).mean()
        d[f"ma{n}_dist"] = (c - d[f"ma{n}"]) / d[f"ma{n}"]

    # --- EMA ---
    for n in [9, 21, 55]:
        d[f"ema{n}"] = c.ewm(span=n, adjust=False).mean()
        d[f"ema{n}_dist"] = (c - d[f"ema{n}"]) / d[f"ema{n}"]

    # --- ATR ---
    tr = pd.concat([
        h - lo,
        (h - c.shift(1)).abs(),
        (lo - c.shift(1)).abs()
    ], axis=1).max(axis=1)
    d["atr14"] = tr.rolling(14).mean()
    d["atr_pct"] = d["atr14"] / c

    # --- RSI ---
    d["rsi14"] = _rsi(c, 14)
    d["rsi7"] = _rsi(c, 7)

    # --- Bollinger Bands ---
    for n, k in [(20, 2.0)]:
        mid = c.rolling(n).mean()
        std = c.rolling(n).std()
        d[f"bb_upper_{n}"] = mid + k * std
        d[f"bb_lower_{n}"] = mid - k * std
        d[f"bb_width_{n}"] = (d[f"bb_upper_{n}"] - d[f"bb_lower_{n}"]) / mid
        d[f"bb_pos_{n}"] = (c - d[f"bb_lower_{n}"]) / (d[f"bb_upper_{n}"] - d[f"bb_lower_{n}"] + 1e-9)

    # --- MACD ---
    ema12 = c.ewm(span=12, adjust=False).mean()
    ema26 = c.ewm(span=26, adjust=False).mean()
    d["macd"] = ema12 - ema26
    d["macd_signal"] = d["macd"].ewm(span=9, adjust=False).mean()
    d["macd_hist"] = d["macd"] - d["macd_signal"]

    # --- Stochastic ---
    low14 = lo.rolling(14).min()
    high14 = h.rolling(14).max()
    d["stoch_k"] = 100 * (c - low14) / (high14 - low14 + 1e-9)
    d["stoch_d"] = d["stoch_k"].rolling(3).mean()

    # --- ボリューム ---
    d["vol_ma20"] = v.rolling(20).mean()
    d["vol_ratio"] = v / (d["vol_ma20"] + 1e-9)

    # --- モメンタム ---
    for n in [1, 3, 5, 10, 20]:
        d[f"ret_{n}"] = c.pct_change(n)

    # --- ボラティリティ ---
    d["vol5"] = c.pct_change().rolling(5).std()
    d["vol20"] = c.pct_change().rolling(20).std()

    # --- 時間帯 (sin/cos エンコーディング) ---
    if "time" in d.columns:
        t = pd.to_datetime(d["time"])
        hour = t.dt.hour + t.dt.minute / 60
        d["hour_sin"] = np.sin(2 * np.pi * hour / 24)
        d["hour_cos"] = np.cos(2 * np.pi * hour / 24)
        dow = t.dt.dayofweek
        d["dow_sin"] = np.sin(2 * np.pi * dow / 7)
        d["dow_cos"] = np.cos(2 * np.pi * dow / 7)

    # 先頭のNaN行を除去
    d.dropna(inplace=True)
    return d


def _rsi(series: pd.Series, period: int) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(period).mean()
    loss = (-delta.clip(upper=0)).rolling(period).mean()
    rs = gain / (loss + 1e-9)
    return 100 - 100 / (1 + rs)


FEATURE_COLS = [
    "body_pct", "upper_wick", "lower_wick", "range_pct",
    "ma5_dist", "ma10_dist", "ma20_dist", "ma50_dist", "ma100_dist", "ma200_dist",
    "ema9_dist", "ema21_dist", "ema55_dist",
    "atr_pct",
    "rsi14", "rsi7",
    "bb_width_20", "bb_pos_20",
    "macd", "macd_signal", "macd_hist",
    "stoch_k", "stoch_d",
    "vol_ratio",
    "ret_1", "ret_3", "ret_5", "ret_10", "ret_20",
    "vol5", "vol20",
    "hour_sin", "hour_cos", "dow_sin", "dow_cos",
]
