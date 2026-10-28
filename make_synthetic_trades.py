#!/usr/bin/env python3
"""verify_edge.py の動作確認用の合成トレード生成（実データではない）。

20候補のうち、候補 edge_real だけに本物のエッジ（毎トレード +0.15 ATR）を入れ、
残りはエッジ無し（ノイズ＋金の上昇ドリフト）。コストはスプレッド0.30固定。
"""
import sys
import numpy as np
import pandas as pd

rng = np.random.default_rng(int(sys.argv[2]) if len(sys.argv) > 2 else 1)
out = sys.argv[1] if len(sys.argv) > 1 else "synthetic_trades.csv"
rows = []
names = [f"noise_{i:02d}" for i in range(19)] + ["edge_real"]
for name in names:
    t = pd.Timestamp("2019-01-01")
    while t < pd.Timestamp("2025-12-31"):
        t += pd.Timedelta(hours=int(rng.integers(30, 80)))
        hold = pd.Timedelta(hours=int(rng.integers(1, 24)))
        atr = float(rng.uniform(8, 20))
        d = int(rng.choice([1, -1]))
        mid = 2000.0
        drift = 0.03 * atr                       # 金の上昇トレンド（全員に効く）
        edge = 0.15 * atr * d if name == "edge_real" else 0.0
        move = rng.normal(0, 0.8 * atr) + drift + edge
        sp = 0.30
        rows.append(dict(candidate=name, open_time=t, close_time=t + hold,
                         direction="BUY" if d == 1 else "SELL",
                         open_bid=mid - sp / 2, open_ask=mid + sp / 2,
                         close_bid=mid + move - sp / 2, close_ask=mid + move + sp / 2,
                         atr=atr, swap=0.0, commission=0.0))
pd.DataFrame(rows).to_csv(out, index=False)
print(f"{out}: {len(rows)} trades")
