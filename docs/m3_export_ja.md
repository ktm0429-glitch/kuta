# M3: EA PC で XAUUSD データを書き出す手順

目的: バックテスト用に TitanFX の XAUUSD を M5 で2年分、CSV にします。
パスワードは一切使いません。MT5 には自分でログインしておくだけです。

## 準備(初回のみ)
1. EA PC に Python 3.11 以上を入れる(<https://www.python.org/>)。インストール時に「Add to PATH」にチェック。
2. このリポジトリ(`ktm0429-glitch/kuta`、ブランチ `claude/xauusd-bot-spec`)を ZIP か git で EA PC に取得する。
3. コマンドプロンプトで、リポジトリのフォルダに移動して実行:
   ```
   py -m pip install MetaTrader5
   ```
4. MT5 を開き、**TitanFX の口座(デモでも本番でも可)にログイン**しておく。
5. MT5 の設定: `ツール → オプション → チャート → チャートの最大バー数` を **無制限** にする。
6. 「気配値表示」に XAUUSD があることを確認(無ければ右クリック → すべてのシンボル、または名前を確認)。
   名前が `XAUUSD` と違う場合(例: `XAUUSD.r`)は、後の手順で `--symbol` に指定します。
7. 履歴を読み込む: XAUUSD の M5 チャートを開き、**Home キーを何度か押して**過去へスクロールし、読み込みが止まるまで待つ。

## 実行
```
py tools\export_mt5.py --years 2 --timeframes M5
```
(1分足も欲しい場合は `--timeframes M5,M1`。サイズが大きくなります。)

出力は `data\` に作られます。
- `XAUUSD_M5.csv.gz` — ローソク足(UTC に変換済み)
- `symbol_info.json` — ロット刻み、契約サイズ、スプレッドなど
- `export_report.json` — 本数、期間、スプレッド統計、欠損、サーバー時刻の検証結果

最後に `WARNING:` が出たら、その内容を Claude に伝えてください(データを使う前に確認します)。

## Claude に渡すもの
1. **`export_report.json` と `symbol_info.json` の中身をチャットに貼る。** 口座情報・パスワードは入っていません(中身を確認してから貼ってください)。
2. **`XAUUSD_M5.csv.gz` を渡す。** 次のどちらか:
   - Claude アプリのこのセッションにファイルとして添付する
   - または、自分の GitHub 認証で別ブランチに push する:
     ```
     git checkout -b data/xauusd-export
     git add -f data\XAUUSD_M5.csv.gz data\symbol_info.json data\export_report.json
     git commit -m "Add XAUUSD M5 export"
     git push -u origin data/xauusd-export
     ```
     (`data/` は通常 `.gitignore` 対象なので `-f` が必要です。)

## うまくいかない時
- `MT5 initialize failed` → MT5 を起動してログイン済みか確認。MT5 と Python のどちらも同じ権限(管理者かどうか)で起動。
- `Symbol ... not found` → 表示された候補から名前を選び `--symbol` に指定。
- 期間が2年に満たない → ブローカーの履歴の深さの限界かもしれません。そのまま報告してください。
