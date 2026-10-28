#!/usr/bin/env python3
"""MT5ストラテジーテスターのディール一覧 → verify_edge.py の入力CSV に変換する

入力:
  --report 候補名=ディール一覧のファイル   （複数指定可。1ファイル=1候補）
      CSV / XLSX / HTML。列: 時間, ディール, シンボル, タイプ, 方向, 数量, 価格, 手数料, スワップ, 損益
      （英語名も可。列名が違う場合は --map で上書き。例: --map price=約定価格）
  --m1   M1足のCSV（Bid基準のOHLCとスプレッド[ポイント]を含むこと）
      MT5の「表示→銘柄→バー→エクスポート」形式（<DATE> <TIME> <OPEN> ... <SPREAD>）か、
      time,open,high,low,close,spread 列のCSV。時刻はレポートと同じサーバー時刻にすること。

変換の考え方:
  - テスターはBUYをAskで約定しBidで決済、SELLをBidで約定しAskで決済する。
    よって「実際に約定した側」の価格はディール価格そのもの。
    反対側の価格だけ、その分のM1足のスプレッドから逆算する（コスト込み損益には影響しない）。
  - ATRはM1をリサンプルし、MT5のATR（TRの単純移動平均。Wilder式ではない）で計算する。
    エントリー時点で完成済みの最後の足の値を使う（先読みなし）。
  - 手数料・スワップは口座通貨(=見積通貨のUSD前提)の金額を、数量×契約サイズで価格単位に直す。

制限（判断不能として扱う）:
  - 部分決済・ナンピン・ドテン(in/out)は未対応。見つけたら止まる。
  - 実レポートでの動作は未検証。列名・タイプ名・HTML構造が違えば --map か列名の修正が必要。
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ALIASES = {
    "time": ["time", "時間", "時刻", "約定時間"],
    "deal": ["deal", "ディール", "約定", "約定番号"],
    "symbol": ["symbol", "シンボル", "銘柄"],
    "type": ["type", "タイプ", "種類"],
    "direction": ["direction", "方向", "新規・決済", "新規/決済"],
    "volume": ["volume", "数量", "ボリューム", "ロット"],
    "price": ["price", "価格"],
    "commission": ["commission", "手数料"],
    "swap": ["swap", "スワップ"],
    "profit": ["profit", "損益", "利益"],
}
TYPE_MAP = {"buy": 1, "買い": 1, "買": 1, "sell": -1, "売り": -1, "売": -1}
DIR_MAP = {"in": "in", "イン": "in", "out": "out", "アウト": "out"}
TF_RULE = {"M5": "5min", "M15": "15min", "M30": "30min", "H1": "1h", "H4": "4h", "D1": "1D"}
TF_DELTA = {k: pd.Timedelta(v) for k, v in TF_RULE.items()}


# ---------------------------------------------------------------- 読み込み
def read_table(path):
    p = Path(path)
    suf = p.suffix.lower()
    if suf in (".xlsx", ".xls"):
        # レポートの上部は要約なので、ディール表の見出し行を探す
        raw = pd.read_excel(p, header=None)
        return _promote_header(raw)
    if suf in (".htm", ".html"):
        for enc in ("utf-16", "utf-8"):
            try:
                tables = pd.read_html(p, encoding=enc, header=None)
                break
            except Exception:
                tables = []
        for t in tables:
            try:
                return _promote_header(t)
            except SystemExit:
                continue
        sys.exit(f"{path}: HTMLにディール表が見つかりません（判断不能。CSV/XLSXで出力するか列名を確認）")
    return pd.read_csv(p, sep=None, engine="python")


def _promote_header(raw):
    need = {"time", "price", "type", "direction"}   # 注文表（方向列なし）と区別する
    for i in range(min(len(raw), 200)):
        names = {_canon(str(v)) for v in raw.iloc[i].tolist()}
        if need <= names:
            df = raw.iloc[i + 1:].copy()
            df.columns = [str(v) for v in raw.iloc[i].tolist()]
            return df.reset_index(drop=True)
    sys.exit("ディール表の見出し行（時間/タイプ/新規・決済/価格）が見つかりません")


def _canon(name):
    n = name.strip().lower()
    for k, vs in ALIASES.items():
        if n in [v.lower() for v in vs]:
            return k
    return n


def num(s):
    """'1 234.50' や '1,234.5' のような文字列を数値にする"""
    return pd.to_numeric(s.astype(str).str.replace(r"[\s,]", "", regex=True), errors="coerce")


def normalize_deals(df, overrides):
    cols = {}
    for c in df.columns:
        key = _canon(str(c))
        cols.setdefault(key, c)
    for k, v in overrides.items():
        if v not in df.columns:
            sys.exit(f"--map {k}={v}: 列が見つかりません。列: {list(df.columns)}")
        cols[k] = v
    miss = [k for k in ("time", "type", "direction", "volume", "price") if k not in cols]
    if miss:
        sys.exit(f"必要な列がありません: {miss}。現在の列: {list(df.columns)}（--map で指定）")
    out = pd.DataFrame({
        "time": pd.to_datetime(df[cols["time"]], errors="coerce"),
        "type": df[cols["type"]].astype(str).str.strip().str.lower(),
        "direction": df[cols["direction"]].astype(str).str.strip().str.lower(),
        "volume": num(df[cols["volume"]]),
        "price": num(df[cols["price"]]),
    })
    for k in ("commission", "swap", "profit"):
        out[k] = num(df[cols[k]]).fillna(0.0) if k in cols else 0.0
    out["symbol"] = df[cols["symbol"]].astype(str) if "symbol" in cols else ""
    out["deal"] = num(df[cols["deal"]]) if "deal" in cols else np.arange(len(df))
    out = out[out["type"].isin(TYPE_MAP)].copy()          # balance 行などを除く
    out = out.dropna(subset=["time", "volume", "price"])
    out["dir"] = out["type"].map(TYPE_MAP)
    out["io"] = out["direction"].map(DIR_MAP)
    if out["io"].isna().any():
        bad = sorted(out.loc[out["io"].isna(), "direction"].unique())
        sys.exit(f"未対応の方向値: {bad}（in/out 以外。ドテン'in/out'は未対応で判断不能）")
    return out.sort_values(["time", "deal"]).reset_index(drop=True)


def pair_deals(d, name):
    """in と out を FIFO で1対1に対応づける（数量が一致しないものは判断不能として停止）"""
    trades = []
    for sym, g in d.groupby("symbol"):
        queue = {1: [], -1: []}                       # 建玉の向き -> in ディール行
        for _, r in g.iterrows():
            if r["io"] == "in":
                queue[r["dir"]].append(r)
            else:
                pos_dir = -r["dir"]                   # buyを閉じるのは sell の out
                if not queue[pos_dir]:
                    sys.exit(f"{name}: 対応する in が無い out があります（{r['time']}）")
                i = queue[pos_dir].pop(0)
                if abs(i["volume"] - r["volume"]) > 1e-9:
                    sys.exit(f"{name}: 部分決済/ナンピンを検出（in {i['volume']} / out {r['volume']}, {i['time']}）。"
                             "未対応のため判断不能")
                trades.append((i, r))
        left = sum(len(v) for v in queue.values())
        if left:
            print(f"注意: {name} {sym}: 決済されていない建玉が{left}件（除外）", file=sys.stderr)
    return trades


# ---------------------------------------------------------------- M1 / ATR
def read_m1(path):
    df = pd.read_csv(path, sep=None, engine="python")
    df.columns = [str(c).strip().strip("<>").lower() for c in df.columns]
    if "date" in df.columns and "time" in df.columns:
        df["time"] = pd.to_datetime(df["date"].astype(str) + " " + df["time"].astype(str))
    elif "time" in df.columns:
        df["time"] = pd.to_datetime(df["time"])
    else:
        sys.exit("M1に time（または date と time）列がありません")
    miss = [c for c in ("open", "high", "low", "close", "spread") if c not in df.columns]
    if miss:
        sys.exit(f"M1に列がありません: {miss}（Ask側の逆算にスプレッドが必須。無ければ判断不能）")
    df = df.sort_values("time").drop_duplicates("time").set_index("time")
    return df[["open", "high", "low", "close", "spread"]].astype(float)


def mt5_atr(m1, tf, period):
    """MT5のATR: TRの単純移動平均。値は足の開始時刻 + 期間 の時点（足が完成した時刻）に有効。"""
    bars = m1.resample(TF_RULE[tf], label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last"}).dropna()
    pc = bars["close"].shift(1)
    tr = pd.concat([bars["high"] - bars["low"], (bars["high"] - pc).abs(),
                    (bars["low"] - pc).abs()], axis=1).max(axis=1)
    tr.iloc[0] = np.nan                               # MT5は先頭足のTRを使わない
    atr = tr.rolling(period).mean()
    atr.index = atr.index + TF_DELTA[tf]              # 完成時刻に付け替える（先読み防止）
    return atr.dropna()


# ---------------------------------------------------------------- 変換本体
def convert(name, deals, m1, atr, a):
    pairs = pair_deals(deals, name)
    rows, prof_gap = [], []
    for i, o in pairs:
        d = int(i["dir"])
        bar_i = m1.index.searchsorted(i["time"].floor("min"), side="right") - 1
        bar_o = m1.index.searchsorted(o["time"].floor("min"), side="right") - 1
        if bar_i < 0 or bar_o < 0:
            sys.exit(f"{name}: M1データが約定時刻 {i['time']} をカバーしていません")
        sp_i = m1["spread"].iloc[bar_i] * a.point
        sp_o = m1["spread"].iloc[bar_o] * a.point
        k = atr.index.searchsorted(i["time"], side="right") - 1
        if k < 0:
            continue                                  # ATRが計算できる前のトレードは除外
        # BUY: 建てはAsk=価格 / 決済はBid=価格。SELL: 建てはBid=価格 / 決済はAsk=価格
        if d == 1:
            oa, ob = i["price"], i["price"] - sp_i
            cb, ca = o["price"], o["price"] + sp_o
        else:
            ob, oa = i["price"], i["price"] + sp_i
            ca, cb = o["price"], o["price"] - sp_o
        unit = i["volume"] * a.contract_size
        # 金額 → 価格単位。手数料は建て・決済の両行、スワップは決済行に付く想定で合算
        com = (i["commission"] + o["commission"]) / unit
        swp = (i["swap"] + o["swap"]) / unit
        # 検算用: ディール価格だけで出した損益 vs レポートの損益(金額)
        calc = d * (o["price"] - i["price"]) * unit
        prof_gap.append(calc - o["profit"])
        rows.append(dict(candidate=name, open_time=i["time"], close_time=o["time"],
                         direction="BUY" if d == 1 else "SELL",
                         open_bid=ob, open_ask=oa, close_bid=cb, close_ask=ca,
                         atr=float(atr.iloc[k]), swap=swp, commission=com))
    gaps = np.abs(np.array(prof_gap))
    if len(gaps):
        bad = int((gaps > max(1.0, 0.01 * np.median(np.abs([r["close_bid"] for r in rows])))).sum())
        print(f"[{name}] トレード{len(rows)}件 / 損益検算(価格×数量×契約サイズ vs レポート損益)の不一致: {bad}件, "
              f"最大差={gaps.max():.2f}", file=sys.stderr)
        if bad > 0.05 * len(gaps):
            print(f"  警告: 5%超が不一致。--contract-size（現在{a.contract_size}）か口座通貨の前提を確認してください",
                  file=sys.stderr)
    # M1のBid範囲との整合（約定したBid側がその分足のレンジ内か）
    ok = tot = 0
    for r in rows:
        b = m1.index.searchsorted(r["open_time"].floor("min"), side="right") - 1
        bid = r["open_bid"]
        tot += 1
        ok += int(m1["low"].iloc[b] - 1e-9 <= bid <= m1["high"].iloc[b] + 1e-9)
    if tot:
        print(f"[{name}] 建てBidがM1足のレンジ内: {ok}/{tot}（低い場合はサーバー時刻のずれを疑う）", file=sys.stderr)
    return pd.DataFrame(rows)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--report", action="append", required=True, metavar="候補名=ファイル")
    p.add_argument("--m1", required=True)
    p.add_argument("--out", default="trades.csv")
    p.add_argument("--atr-tf", default="H1", choices=list(TF_RULE))
    p.add_argument("--atr-period", type=int, default=14)
    p.add_argument("--contract-size", type=float, default=100.0, help="XAUUSDは通常100oz。ブローカー仕様で要確認")
    p.add_argument("--point", type=float, default=0.01, help="1ポイントの価格幅。XAUUSD(2桁)は0.01。要確認")
    p.add_argument("--map", action="append", default=[], metavar="内部名=列名")
    a = p.parse_args()

    overrides = dict(m.split("=", 1) for m in a.map)
    m1 = read_m1(a.m1)
    atr = mt5_atr(m1, a.atr_tf, a.atr_period)
    frames = []
    for spec in a.report:
        if "=" not in spec:
            sys.exit("--report は 候補名=ファイル の形式で指定してください")
        name, path = spec.split("=", 1)
        deals = normalize_deals(read_table(path), overrides)
        frames.append(convert(name, deals, m1, atr, a))
    out = pd.concat(frames, ignore_index=True)
    out.to_csv(a.out, index=False)
    print(f"{a.out}: {len(out)}件 / 候補数 N = {out['candidate'].nunique()}")


if __name__ == "__main__":
    main()
