# KUTA ML XAUUSD EA — セットアップガイド

## システム構成

```
EA専用PC (Windows)
├── MetaTrader 5
│   └── KUTA_ML_XAUUSD.mq5  ← EA本体
└── Python (常時起動)
    ├── ml_server.py         ← 推論サーバー (localhost:5000)
    └── scheduler.py         ← 毎日03:00に自動再学習
```

## セットアップ手順

### 1. Python インストール
- Python 3.10 以上をインストール: https://www.python.org/

### 2. EAファイルをコピー
```
EA/KUTA_ML_XAUUSD.mq5
  → C:\Users\<ユーザー名>\AppData\Roaming\MetaQuotes\Terminal\<ID>\MQL5\Experts\
```

### 3. MT5のWebRequest許可設定
MetaTrader 5 → ツール → オプション → エキスパートアドバイザー
- 「次のURLへのWebRequestを許可する」にチェック
- URL追加: `http://127.0.0.1:5000`

### 4. データフォルダ作成
```
C:\Users\<ユーザー名>\AppData\Roaming\MetaQuotes\Terminal\<ID>\MQL5\Files\KUTA_ML\data\
```

### 5. Pythonサービス起動
```
python/start_all.bat をダブルクリック
```

### 6. EA起動
- MT5でXAUUSD H1チャートを開く
- KUTA_ML_XAUUSD をチャートにドラッグ
- 自動売買を有効化

## 学習サイクル

```
[起動時]
  └─ Pythonが過去データで初回学習

[毎日03:00 UTC]
  └─ 蓄積した取引データ + 最新OHLCVで再学習
  └─ サーバーが新モデルを自動ロード

[取引ごと]
  └─ EAが損益をサーバーに報告 → CSVに蓄積
```

## パラメーター調整ポイント

| パラメーター | デフォルト | 説明 |
|---|---|---|
| InpSignalThresh | 0.60 | 高くするほど慎重 (0.55〜0.75推奨) |
| InpRiskPercent | 1.0 | 口座残高の何%をリスクにかけるか |
| InpATRMultSL | 1.5 | SL = ATR × この値 |
| InpATRMultTP | 3.0 | TP = ATR × この値 (RR比 = 2.0) |
| InpMaxOpenTrades | 1 | 同時ポジション数 |

## ログ確認

```
data/server.log    ← 推論サーバーログ
data/scheduler.log ← 学習スケジューラーログ
data/trades.csv    ← 取引履歴
models/metrics.json← 最新モデルのAUCスコア
```

## 注意事項

- 初回は最低500本のH1バーが必要（約20営業日）
- EAを動かしながらデータを蓄積 → 学習精度が徐々に向上
- バックテストは MetaTrader 5 のストラテジーテスターで実施可能
