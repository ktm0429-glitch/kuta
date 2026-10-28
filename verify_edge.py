#!/usr/bin/env python3
"""EAエッジ検証スクリプト（CLAUDE.md の検証プロトコルを実装）

入力: 候補ごとのトレード一覧CSV（1ファイル、candidate列で候補を区別）。
必須列:
  candidate    候補名（パラメータ違い・時間帯違いも別候補として扱う）
  open_time    約定時刻（サーバー時刻）
  close_time   決済時刻（サーバー時刻）
  direction    BUY / SELL（または 1 / -1）
  open_bid, open_ask, close_bid, close_ask  約定・決済時点のBid/Ask（価格単位）
  atr          エントリー時点のATR（価格単位。MT5のiATRと同じ計算式で出したもの）
任意列:
  swap         スワップ合計（価格単位の符号付き。無ければ0）
  commission   手数料（価格単位の符号付き。無ければ0）
  signal       エントリー時の説明変数（相関検定をしたい場合のみ）

使い方（2段階。検証期間は select 後の validate で1回しか見ない）:
  python3 verify_edge.py select   trades.csv --split 2024-01-01 --outdir out
  python3 verify_edge.py validate trades.csv --outdir out

注意:
  - SL/トレイルのM1判定は、入力のバックテスト側（M1以下の足で実行）に依存する。
    このスクリプトはトレード一覧を再シミュレーションしない。
  - 年平均控除は、同じ年の全候補・全トレードの相場変動(ATR比)の平均を、
    方向を掛けて引く。条件付きの平均なので、エッジの一部も削る可能性がある（保守側）。
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

ALPHA = 0.05
MIN_TRADES = 30       # これ未満は統計的に判断不能
MIN_YEARS = 3         # 年別判定に必要な最小年数
MIN_TRADES_PER_YEAR = 10  # これ未満の年（端の欠け年など）は年別判定から除く
SAME_SIGN_RATIO = 0.75
MIN_ABS_R = 0.05

REQUIRED = ["candidate", "open_time", "close_time", "direction",
            "open_bid", "open_ask", "close_bid", "close_ask", "atr"]


def file_hash(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_trades(path):
    df = pd.read_csv(path)
    miss = [c for c in REQUIRED if c not in df.columns]
    if miss:
        sys.exit(f"必須列がありません: {miss}（Bid/Askが無い結果はコスト込みにできないため判定不能）")
    df["open_time"] = pd.to_datetime(df["open_time"])
    df["close_time"] = pd.to_datetime(df["close_time"])
    d = df["direction"].astype(str).str.upper().map(
        {"BUY": 1, "1": 1, "SELL": -1, "-1": -1})
    if d.isna().any():
        sys.exit("direction は BUY/SELL か 1/-1 にしてください")
    df["dir"] = d.astype(int)
    for c in ["swap", "commission"]:
        if c not in df.columns:
            df[c] = 0.0
        df[c] = df[c].fillna(0.0)
    if (df["atr"] <= 0).any() or df["atr"].isna().any():
        sys.exit("atr に0以下または欠損があります")
    return df.sort_values(["candidate", "open_time"]).reset_index(drop=True)


def add_pnl(df):
    """BUYはAsk約定→Bid決済、SELLはBid約定→Ask決済。スワップ・手数料を足す。"""
    buy = df["dir"] == 1
    df["net"] = np.where(buy, df["close_bid"] - df["open_ask"],
                         df["open_bid"] - df["close_ask"]) + df["swap"] + df["commission"]
    mid_o = (df["open_bid"] + df["open_ask"]) / 2
    mid_c = (df["close_bid"] + df["close_ask"]) / 2
    df["gross"] = df["dir"] * (mid_c - mid_o)          # コスト無し（参考値）
    df["move_atr"] = (mid_c - mid_o) / df["atr"]        # 方向を掛けない相場変動
    df["year"] = df["open_time"].dt.year
    return df


def thin(df):
    """候補ごとに、保有が重なるトレードを間引く（先に建てたものを残す）。"""
    keep = []
    for _, g in df.groupby("candidate", sort=False):
        last_close = pd.Timestamp.min
        for idx, row in g.iterrows():
            if row["open_time"] >= last_close:
                keep.append(idx)
                last_close = row["close_time"]
    return df.loc[keep]


def detrend(df):
    """ATR正規化し、同年の相場変動の平均(方向を掛ける)を引く。"""
    drift = df.groupby("year")["move_atr"].mean()
    df = df.copy()
    df["drift"] = df["year"].map(drift)
    df["adj"] = df["net"] / df["atr"] - df["dir"] * df["drift"]
    return df


def year_stats(g):
    cnt = g.groupby("year")["adj"].size()
    ys = g.groupby("year")["adj"].sum()[cnt >= MIN_TRADES_PER_YEAR]
    total_sign = np.sign(ys.sum())
    ratio = float((np.sign(ys) == total_sign).mean()) if total_sign != 0 and len(ys) else 0.0
    return ys, ratio


def eval_candidate(g, n_cand):
    """1候補の統計。g は間引き・年平均控除済み。"""
    n = len(g)
    out = {"n": n, "mean_adj": float(g["adj"].mean()) if n else np.nan,
           "net_sum": float(g["net"].sum()), "gross_sum_ref": float(g["gross"].sum())}
    if n >= 2 and g["adj"].std() > 0:
        t, p = stats.ttest_1samp(g["adj"], 0.0)
        out["t"], out["p"] = float(t), float(p)
    else:
        out["t"], out["p"] = np.nan, 1.0
    out["p_bonf"] = min(1.0, out["p"] * n_cand)
    ys, ratio = year_stats(g)
    out["years"], out["same_sign_ratio"] = len(ys), ratio
    out["year_table"] = {int(k): float(v) for k, v in ys.items()}
    if "signal" in g.columns and g["signal"].notna().sum() >= MIN_TRADES:
        s = g.dropna(subset=["signal"])
        rp, pp = stats.pearsonr(s["signal"], s["adj"])
        rs, ps = stats.spearmanr(s["signal"], s["adj"])
        out.update(pearson=float(rp), spearman=float(rs), pearson_p=float(pp))
        out["corr_ok"] = bool(abs(rp) > MIN_ABS_R and abs(rs) > MIN_ABS_R
                              and np.sign(rp) == np.sign(rs))
    else:
        out["corr_ok"] = None   # 該当なし
    return out


def prepare(path):
    raw = load_trades(path)
    raw = add_pnl(raw)
    before = raw.groupby("candidate").size()
    th = thin(raw)
    after = th.groupby("candidate").size()
    return raw, th, before, after


def cmd_select(a):
    out = Path(a.outdir)
    out.mkdir(parents=True, exist_ok=True)
    raw, th, before, after = prepare(a.trades)
    n_cand = th["candidate"].nunique()
    split = pd.Timestamp(a.split)
    sel = detrend(th[th["open_time"] < split])
    val_n = int((th["open_time"] >= split).sum())
    print(f"候補総数 N = {n_cand}（Bonferroni補正の係数）")
    print(f"選択期間: {sel['open_time'].min().date()} 〜 {split.date()} 未満 / 検証期間: {split.date()} 以降（{val_n}件、まだ見ない）")
    print("注意: 候補を追加・削除したらNが変わるため、最初からやり直すこと。\n")

    rows, survivors = [], []
    for c, g in sel.groupby("candidate"):
        r = eval_candidate(g, n_cand)
        r["candidate"] = c
        r["n_before_thin"] = int(before.get(c, 0))
        r["n_all_after_thin"] = int(after.get(c, 0))
        ok = (r["n"] >= MIN_TRADES and r["mean_adj"] > 0 and r["p_bonf"] < ALPHA
              and r["years"] >= MIN_YEARS and r["same_sign_ratio"] >= SAME_SIGN_RATIO
              and r["corr_ok"] is not False)
        r["pass_selection"] = bool(ok)
        if ok:
            survivors.append(c)
        rows.append(r)
    res = pd.DataFrame(rows).drop(columns=["year_table"])
    res.to_csv(out / "selection.csv", index=False)
    show = ["candidate", "n_before_thin", "n", "mean_adj", "p", "p_bonf",
            "years", "same_sign_ratio", "pass_selection"]
    print(res[show].sort_values("p_bonf").to_string(index=False, float_format=lambda x: f"{x:.4g}"))
    for r in rows:
        if r["pass_selection"]:
            print(f"\n[{r['candidate']}] 選択期間の年別損益(ATR正規化・年平均控除後・合計): {r['year_table']}")

    state = {"data_sha256": file_hash(a.trades), "split": str(split), "n_candidates": n_cand,
             "survivors": survivors, "validated": False}
    (out / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=2))
    print(f"\n選択期間を通過: {len(survivors)}/{n_cand}")
    if not survivors:
        print("判定: REJECTED。通過候補なし。検証期間は見ていない。改善案は出さず、この仮説からの撤退を勧める。")
    else:
        print("次: validate を実行（検証期間を見るのは1回だけ）")


def cmd_validate(a):
    out = Path(a.outdir)
    sp = out / "state.json"
    if not sp.exists():
        sys.exit("先に select を実行してください")
    state = json.loads(sp.read_text())
    if state["validated"]:
        sys.exit("検証期間は使用済みです。条件を変えて再検証するには、新しい期間を取り、select からやり直してください。")
    if state["data_sha256"] != file_hash(a.trades):
        sys.exit("select 時と入力データが違います。select からやり直してください。")
    if not state["survivors"]:
        sys.exit("通過候補がありません。判定: REJECTED（撤退を勧める）")

    raw, th, before, after = prepare(a.trades)
    split = pd.Timestamp(state["split"])
    n_cand = state["n_candidates"]
    val = detrend(th[th["open_time"] >= split])
    state["validated"] = True                      # 先に使用済みにする（見たら戻さない）
    sp.write_text(json.dumps(state, ensure_ascii=False, indent=2))

    verdicts = []
    for c in state["survivors"]:
        g = val[val["candidate"] == c]
        r = eval_candidate(g, n_cand)
        notes = []
        if r["n"] < MIN_TRADES:
            notes.append(f"件数{r['n']}<{MIN_TRADES}で判断不能")
        if r["years"] < MIN_YEARS:
            notes.append(f"検証期間{r['years']}年<{MIN_YEARS}年で年別判定は判断不能")
        undecidable = bool(notes)
        hard_fail = (r["n"] > 0 and (r["mean_adj"] <= 0 or r["p_bonf"] >= ALPHA)) or \
                    (r["years"] >= MIN_YEARS and r["same_sign_ratio"] < SAME_SIGN_RATIO)
        if r["n"] == 0:
            hard_fail = True
        if hard_fail:
            v = "REJECTED"
        elif undecidable or r["corr_ok"] is False:
            v = "CONDITIONAL"
            if r["corr_ok"] is False:
                notes.append("相関の基準(|r|>0.05かつSpearman/Pearson符号一致)を満たさない")
        else:
            v = "APPROVED"
        r.update(candidate=c, verdict=v, notes=notes)
        verdicts.append(r)
        print(f"\n== {c}: {v} ==")
        print(f"  検証期間 n={r['n']}（間引き後） 平均(ATR比,年平均控除後)={r['mean_adj']:.4f} "
              f"p={r['p']:.4g} Bonferroni後p={r['p_bonf']:.4g}（N={n_cand}）")
        print(f"  コスト込み損益合計={r['net_sum']:.2f} / コスト無し(参考値)={r['gross_sum_ref']:.2f}")
        print(f"  年別損益(adj合計): {r['year_table']}  同符号の年の割合={r['same_sign_ratio']:.0%}")
        if r["corr_ok"] is not None:
            print(f"  相関: Pearson={r['pearson']:.3f} Spearman={r['spearman']:.3f}")
        for n in notes:
            print(f"  判断不能/注記: {n}")
    pd.DataFrame([{k: v for k, v in r.items() if k != "year_table"} for r in verdicts]) \
        .to_csv(out / "validation.csv", index=False)

    order = ["APPROVED", "CONDITIONAL", "REJECTED"]
    best = min((r["verdict"] for r in verdicts), key=order.index)
    print(f"\n最終判定: {best}")
    if best == "REJECTED":
        print("エッジは確認できませんでした。パラメータを足す改善ではなく、この仮説からの撤退を勧めます。")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("select", help="選択期間で候補を絞る（検証期間は見ない）")
    s.add_argument("trades")
    s.add_argument("--split", required=True, help="選択期間と検証期間の境界日 (YYYY-MM-DD)")
    s.add_argument("--outdir", default="out")
    s.set_defaults(f=cmd_select)
    v = sub.add_parser("validate", help="検証期間を1回だけ評価して判定")
    v.add_argument("trades")
    v.add_argument("--outdir", default="out")
    v.set_defaults(f=cmd_validate)
    a = p.parse_args()
    a.f(a)


if __name__ == "__main__":
    main()
