# kuta
保存用

## EAエッジ検証ツール

MT5のバックテスト結果が「コスト込みで実口座でも通用するか」を、`CLAUDE.md` の検証プロトコルに沿って判定する。
最終判定は APPROVED / CONDITIONAL / REJECTED の3区分。エッジが見えなければ撤退を提案する。

| ファイル | 役割 |
|---|---|
| `CLAUDE.md` | 検証プロトコル（判定基準・約定モデル・報告書式）。ツールの仕様の元 |
| `convert_mt5_report.py` | MT5のディール一覧とM1足 → 検証用CSV に変換 |
| `verify_edge.py` | 検証本体。`select`（候補の絞り込み）と `validate`（検証期間の評価）の2段階 |
| `make_synthetic_trades.py` | 動作確認用の合成トレード生成（実データではない） |

### 準備

```
pip install pandas numpy scipy
# HTML/XLSXのレポートを読む場合は lxml / openpyxl も必要
```

### 手順

**1. 候補をすべて決める。** パラメータ違い・時間帯違い・銘柄違いも1候補。数えた総数が N になる。
途中で候補を足したら N が変わるので、最初からやり直す。1候補ごとにテスターを回し、ディール一覧を保存する。

**2. 変換する。** `--report 候補名=ファイル` を候補の数だけ並べる。

```
python3 convert_mt5_report.py \
  --report A=dealsA.csv --report B=dealsB.csv \
  --m1 xauusd_m1.csv --out trades.csv
```

- M1足は、Bid基準のOHLCとスプレッド（ポイント）を含むこと。MT5の「バー → エクスポート」形式（`<DATE> <TIME> <OPEN> … <SPREAD>`）か、`time,open,high,low,close,spread` 列のCSV。
- 時刻はレポートと同じサーバー時刻にする。
- 既定値は XAUUSD 前提（`--contract-size 100`、`--point 0.01`）。銘柄・ブローカーに合わせて変える（例: USDJPY は `--contract-size 100000 --point 0.001`）。
- HTMLレポートには「注文」表と「約定」表があり、方向（新規・決済）列を持つ「約定」表を自動で選ぶ。M1足は**対象銘柄のもの**を用意する。
- ATRは MT5 と同じ（TRの単純移動平均、Wilder式ではない）。既定は H1・14期間（`--atr-tf` `--atr-period`）。
- 列名が違うときは `--map price=約定価格` のように指定する。

変換時の標準エラー出力を必ず見る。
- 「損益検算の不一致」が多い → 契約サイズか口座通貨の前提が違う。
- 「建てBidがM1足のレンジ内」が低い → サーバー時刻のずれを疑う。

**3. 選択期間で絞る。** 境界日より前が選択期間、以降が検証期間。この段階では検証期間を見ない。

```
python3 verify_edge.py select trades.csv --split 2024-01-01 --outdir out
```

候補総数 N、候補ごとの件数（間引き前後）、補正前後の p 値、年別同符号の割合が出る。
通過条件は、件数30以上・平均が正・Bonferroni補正後 p < 0.05・3年以上で同符号75%以上。通過ゼロなら REJECTED で、撤退を勧める。

**4. 検証期間を1回だけ評価する。**

```
python3 verify_edge.py validate trades.csv --outdir out
```

通過した候補だけを、検証期間で評価して判定する。**実行は1回だけ。** 2回目以降、または入力CSVが変わっている場合は拒否される。
条件を変えて検証し直すときは、新しい期間を取り、`select` からやり直す（使用済みの期間は再利用しない）。

結果は `out/selection.csv`、`out/validation.csv`、`out/state.json` に出る。

### 入力CSVの列（`verify_edge.py`）

必須: `candidate, open_time, close_time, direction, open_bid, open_ask, close_bid, close_ask, atr`
任意: `swap, commission`（価格単位の符号付き）、`signal`（相関を検定したい説明変数）

`direction` は BUY / SELL（または 1 / -1）。Bid/Ask が無い結果は、コスト込みにできないので受け付けない。

### 計算の中身

- **損益**: BUY は Ask で建てて Bid で決済、SELL は Bid で建てて Ask で決済し、スワップと手数料を足す。コスト無しの損益は「参考値」として併記するだけで、判定には使わない。
- **間引き**: 候補ごとに、保有が重なるトレードを落とす（先に建てたものを残す）。
- **トレンド除去**: 損益を ATR で割り、同じ年の相場変動の平均（ATR比、売買方向を掛ける）を引く。
- **有意性**: 調整後損益の平均に対する t 検定。p 値に N を掛けて Bonferroni 補正する。
- **年別**: 件数10未満の年は除く。年別損益の符号が全体の符号と同じ年の割合を出す。
- **相関**: `signal` 列があれば Pearson と Spearman を出す。|r| > 0.05 で符号が一致していること。
- **判定**:
  - APPROVED: 検証期間で、平均が正、補正後 p < 0.05、年別同符号75%以上（3年以上）、件数30以上、相関の基準を満たす。
  - CONDITIONAL: 上記の否定条件には当たらないが、件数不足・検証期間が3年未満・相関の基準未達のいずれかがある。
  - REJECTED: 検証期間の平均が0以下、補正後に非有意、または年別同符号が75%未満。

### 制限（判断不能として扱う）

- SL・トレイルのM1判定は再現しない。入力のバックテストを M1 以下の足で実行すること。
- 年平均の控除は、同じ年の全候補・全トレードの平均を使う。条件付きの平均なので、エッジの一部も削る（保守側）。
- 部分決済・ナンピン・ドテンは非対応（検出したら停止）。1ポジションずつ建てる戦略が前提。
- 口座通貨が見積通貨（USD）である前提。M1足のスプレッドが足の始値時点かは未確認。
- 実レポート1件（Titan FX MT5 Build 6230、日本語HTML、USDJPY）で、約定表の読み込み・in/out の対応づけ・損益検算の一致までは確認した。M1足を付けた変換から検証までを通した実データでの実行は未確認。他ブローカーや英語版の列名は未確認。
- 合成データで確認したのは、エッジのある1候補が通り、エッジの無い候補が落ちること。実運用の収益性の保証ではない。

### 動作確認（合成データ）

```
python3 make_synthetic_trades.py syn.csv
python3 verify_edge.py select syn.csv --split 2023-01-01 --outdir out
python3 verify_edge.py validate syn.csv --outdir out
```
