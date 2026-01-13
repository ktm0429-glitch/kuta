---
name: mql5-ea-dev
description: MQL5/MT5用のExpert Advisor（EA）開発ガイド。MT5用EA開発、MQL5コード生成、トレードロジック実装、エラーハンドリング、ポジション管理の実装時に使用。
user-invocable: true
---

# EA Development Project with Claude Code

## プロジェクト概要
MT5用EA（Expert Advisor）の開発プロジェクト

## 開発方針
- **言語**: MQL5（MetaTrader 5用）
- **スタイル**: 日本語コメント必須
- **エラーハンドリング**: 必ず含める
- **ログ出力**: デバッグ用ログを充実させる

## デフォルト設定
| 項目 | 値 | 備考 |
|------|-----|------|
| ロット数 | 0.01 | 固定 |
| マジックナンバー | 12345〜 | 過去と被らないように |
| スプレッド制限 | 25ポイント | |
| 最大同時ポジション | 1 | マジックナンバー毎 |

## 注意事項（MT5 vs MT4）
- `OrderSend()` → `MqlTradeRequest`構造体を使用
- `PositionsTotal()` → 保有ポジション数
- `OrdersTotal()` → 待機注文数（MT4とは異なる）
- `OrderSelect()` は存在しない → `PositionGetTicket()`を使用

## 必須ルール

### 1. MQL5/MT5形式
- **MT4形式は禁止** - MQL5専用コードのみ使用
- `#property strict` を使用

### 2. トレード実行
- **CTradeクラス推奨**: `#include <Trade\Trade.mqh>`
- MqlTradeRequest構造体を使用する場合も可
```mql5
CTrade trade;
trade.SetExpertMagicNumber(MagicNumber);
trade.SetDeviationInPoints(Slippage);
```

### 3. 日本語コメント必須
- 全ての関数に日本語で目的を記述
- 重要なロジックには説明コメント

### 4. エラーハンドリング
- `GetLastError()` で全エラーをログ出力
```mql5
int error = GetLastError();
Print("エラーコード=", error);
```

### 5. StopsLevel自動対応
- `SYMBOL_TRADE_STOPS_LEVEL` を取得
- SL/TPがStopsLevel未満の場合は自動調整
```mql5
int stopsLevel = (int)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
int adjustedSL = MathMax(StopLossPips, stopsLevel + 1);
```

### 6. 新バー判定（多重発注防止）
```mql5
datetime lastBarTime = 0;

bool IsNewBar()
{
   datetime currentBarTime = iTime(_Symbol, PERIOD_CURRENT, 0);
   if(currentBarTime != lastBarTime)
   {
      lastBarTime = currentBarTime;
      return true;
   }
   return false;
}
```

### 7. スプレッドチェック
```mql5
input int MaxSpread = 25; // 最大許容スプレッド（ポイント）

bool IsSpreadOK()
{
   int spread = (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   return (spread <= MaxSpread);
}
```

### 8. ポジション数制限
```mql5
int CountPositions(int magic)
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket <= 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == magic)
      {
         count++;
      }
   }
   return count;
}
```

## テンプレートファイル
`claude-generated-eas/EA_Template.mq5`

## フォルダ構成
```
📁 antigravity
  ├── 📁 claude-generated-eas/  ← 生成EA保存先
  │     └── EA_Template.mq5
  ├── InterLogicControl.mqh     ← 干渉制御ライブラリ
  ├── SampleEA.mq5
  ├── EA_RULES.md               ← このファイル
  └── CLAUDE.md
```

## 使用方法

このSkillは以下のような依頼時に自動的に適用されます：
- 「MQL5でEAを作成して」
- 「MT5用のトレードロジックを実装して」
- 「Expert Advisorのコードをレビューして」
- 「EAのエラーハンドリングを追加して」

Claude Codeは上記のルールに従ってMQL5コードを生成・修正します。
