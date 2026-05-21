//+------------------------------------------------------------------+
//| XAUUSD_VGRSI_EA.mq5                                              |
//| VGRSI EA - XAU/USD (Gold) 専用版                                 |
//| Based on: arXiv:2605.01300 (Rafał Rak, 2026)                    |
//|                                                                   |
//| 汎用版との違い:                                                    |
//|   - ロング/ショート/両方 の方向フィルター                           |
//|     (論文: Gold は 18ロング:6ショートとロング優勢)                  |
//|   - スプレッドフィルター (Gold はスプレッド急拡大が多い)              |
//|   - 取引時間フィルター (ロンドン/NY セッション指定可)                 |
//|   - トレーリングストップ (Gold の急騰局面を逃さない)                  |
//|   - 最小 SL を $5 相当 (500pts) に設定                            |
//|   - スリッページ許容を広めに設定 (Gold: 50pts)                     |
//+------------------------------------------------------------------+
#property copyright "Based on arXiv:2605.01300"
#property link      "https://arxiv.org/abs/2605.01300"
#property version   "1.00"

#include <Trade\Trade.mqh>

enum ENUM_TRADE_DIR { DIR_BOTH=0, DIR_LONG_ONLY=1, DIR_SHORT_ONLY=2 };

//--- 入力パラメータ
input group "=== VGRSI パラメータ ==="
input int    InpWS                = 20;       // WS: 集計ウィンドウ
input int    InpWV                = 50;       // WV: 後方可視距離 (Gold: やや長め)

input group "=== エントリー条件 ==="
input double InpBuyThresh         = 35.0;     // 買いクロスライン (A0 がこれを上抜け)
input double InpSellThresh        = 70.0;     // 売りクロスライン (A0 がこれを下抜け)
input ENUM_TRADE_DIR InpDir       = DIR_BOTH; // 取引方向 (論文: Gold はロング優勢)

input group "=== マルチタイムフレーム ==="
input ENUM_TIMEFRAMES InpTF_Trigger = PERIOD_M1;   // トリガー TF: クロス検出
input ENUM_TIMEFRAMES InpTF_Mid     = PERIOD_M5;   // 中間 TF:    方向確認
input ENUM_TIMEFRAMES InpTF_High    = PERIOD_M30;  // 上位 TF:    トレンド確認

input group "=== SL/TP ==="
input int    InpSLN               = 20;       // SL/TP 算出に使うローソク本数
input double InpSLZ               = 2.0;      // SL/TP 乗数
input double InpMinSL_Pts         = 500;      // 最小 SL (500pts = $5, _Point=0.01 の場合)

input group "=== トレーリングストップ ==="
input bool   InpUseTrail          = true;     // トレーリングストップを使用
input double InpTrailActivate_Pts = 300;      // 起動する利益 (pts)
input double InpTrailDistance_Pts = 200;      // 現在値からの距離 (pts)

input group "=== フィルター ==="
input double InpMaxSpread_Pts     = 50;       // 最大許容スプレッド (pts)
input int    InpStartHour         = 0;        // 取引開始時刻 (UTC, 0=制限なし)
input int    InpEndHour           = 24;       // 取引終了時刻 (UTC, 24=制限なし)

input group "=== 資金管理 ==="
input double InpLot               = 0.1;
input int    InpMaxPos            = 2;
input ulong  InpMagic             = 202601;   // XAUUSD 専用マジックナンバー

//--- 内部構造体
struct TFState
{
   ENUM_TIMEFRAMES tf;
   datetime        lastBar;
   double          a0Curr;   // bar[1]: 直近確定足の A0
   double          a0Prev;   // bar[2]: 1本前の A0
};

//--- グローバル変数
CTrade   g_trade;
TFState  g_tf[3];
datetime g_lastEntryBar = 0;

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpWS <= 0 || InpWV <= 0)
   {
      Print("XAUUSD_VGRSI_EA: WS/WV は 1 以上にしてください");
      return INIT_PARAMETERS_INCORRECT;
   }

   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(50);   // Gold: 広めのスリッページ許容

   g_tf[0].tf = InpTF_Trigger;
   g_tf[1].tf = InpTF_Mid;
   g_tf[2].tf = InpTF_High;

   for(int i = 0; i < 3; i++)
   {
      g_tf[i].lastBar = 0;
      g_tf[i].a0Curr  = 50.0;
      g_tf[i].a0Prev  = 50.0;
   }

   return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
// 可視性グラフ: 点 iIdx が点 jIdx から「見える」か判定
//+------------------------------------------------------------------+
bool IsVisible(const double &p[], int iIdx, int jIdx)
{
   if(iIdx - jIdx <= 1) return true;
   double span = (double)(iIdx - jIdx);
   for(int k = jIdx + 1; k < iIdx; k++)
   {
      double lv = p[jIdx] + (p[iIdx] - p[jIdx]) * (double)(k - jIdx) / span;
      if(p[k] >= lv) return false;
   }
   return true;
}

//+------------------------------------------------------------------+
// VGRSI A0 計算 (AsSeries=true、barIndex=1 が直近確定足)
//+------------------------------------------------------------------+
double CalcA0(const double &price[], int total, int barIndex)
{
   double sumP = 0.0, sumM = 0.0;
   int    cntP = 0,   cntM = 0;

   for(int jOff = 0; jOff < InpWS; jOff++)
   {
      int jIdx = barIndex + jOff;
      int vis  = 0;
      for(int iOff = 1; iOff <= InpWV; iOff++)
      {
         int iIdx = jIdx + iOff;
         if(iIdx + 1 >= total) break;
         if(IsVisible(price, iIdx, jIdx))
         {
            if(++vis > InpWS) break;
            double d = price[iIdx] - price[iIdx + 1];
            if(d > 0.0)      { sumP += d;  cntP++; }
            else if(d < 0.0) { sumM += -d; cntM++; }
         }
      }
   }

   if(sumM <= 0.0 || cntM <= 0) return 100.0;
   if(sumP <= 0.0 || cntP <= 0) return 0.0;
   double rS = sumP / sumM;
   double rN = (double)cntP / (double)cntM;
   return 100.0 - 100.0 / (1.0 + (rS + rN) / 2.0);
}

//+------------------------------------------------------------------+
// TF キャッシュ更新 (新しい確定バーのときのみ再計算)
//+------------------------------------------------------------------+
bool UpdateState(TFState &s)
{
   datetime bt[1];
   ArraySetAsSeries(bt, true);
   if(CopyTime(_Symbol, s.tf, 1, 1, bt) < 1) return false;
   if(bt[0] == s.lastBar) return true;

   int    needed = InpWS + InpWV + 4;
   double cls[];
   ArraySetAsSeries(cls, true);
   if(CopyClose(_Symbol, s.tf, 0, needed, cls) < needed) return false;

   s.a0Curr = CalcA0(cls, needed, 1);
   s.a0Prev = CalcA0(cls, needed, 2);
   s.lastBar = bt[0];
   return true;
}

//+------------------------------------------------------------------+
// 直近 InpSLN 本のローソク高さ中央値
//+------------------------------------------------------------------+
double CalcMedianHeight()
{
   double h[], l[], ht[];
   ArraySetAsSeries(h, true);
   ArraySetAsSeries(l, true);
   if(CopyHigh(_Symbol, PERIOD_CURRENT, 1, InpSLN, h) < InpSLN) return 0.0;
   if(CopyLow (_Symbol, PERIOD_CURRENT, 1, InpSLN, l) < InpSLN) return 0.0;
   ArrayResize(ht, InpSLN);
   for(int i = 0; i < InpSLN; i++) ht[i] = h[i] - l[i];
   ArraySort(ht);
   int n = InpSLN;
   return (n % 2 == 1) ? ht[n / 2] : (ht[n / 2 - 1] + ht[n / 2]) / 2.0;
}

//+------------------------------------------------------------------+
// このEAが管理するポジション数
//+------------------------------------------------------------------+
int CountMyPos()
{
   int cnt = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(PositionGetTicket(i) <= 0) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      cnt++;
   }
   return cnt;
}

//+------------------------------------------------------------------+
// 取引時間フィルター (UTC ベース)
//+------------------------------------------------------------------+
bool IsTradeTime()
{
   if(InpStartHour == 0 && InpEndHour == 24) return true;
   MqlDateTime dt;
   TimeToStruct(TimeGMT(), dt);
   int h = dt.hour;
   // 日をまたぐ設定 (例: 22〜06) も考慮
   if(InpStartHour < InpEndHour)
      return (h >= InpStartHour && h < InpEndHour);
   else
      return (h >= InpStartHour || h < InpEndHour);
}

//+------------------------------------------------------------------+
// トレーリングストップ管理
//+------------------------------------------------------------------+
void ManageTrailingStop()
{
   if(!InpUseTrail) return;

   double activatePts = InpTrailActivate_Pts * _Point;
   double distPts     = InpTrailDistance_Pts * _Point;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      if(!PositionGetTicket(i)) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if((ulong)PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;

      long   ptype  = PositionGetInteger(POSITION_TYPE);
      double open   = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl     = PositionGetDouble(POSITION_SL);
      double tp     = PositionGetDouble(POSITION_TP);
      ulong  ticket = (ulong)PositionGetInteger(POSITION_TICKET);

      if(ptype == POSITION_TYPE_BUY)
      {
         double bid    = SymbolInfoDouble(_Symbol, SYMBOL_BID);
         if(bid - open < activatePts) continue;
         double newSL  = bid - distPts;
         if(newSL > sl + _Point)
            g_trade.PositionModify(ticket, newSL, tp);
      }
      else if(ptype == POSITION_TYPE_SELL)
      {
         double ask    = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
         if(open - ask < activatePts) continue;
         double newSL  = ask + distPts;
         if(sl == 0.0 || newSL < sl - _Point)
            g_trade.PositionModify(ticket, newSL, tp);
      }
   }
}

//+------------------------------------------------------------------+
void OnTick()
{
   ManageTrailingStop();

   for(int i = 0; i < 3; i++)
      if(!UpdateState(g_tf[i])) return;

   // Trigger TF の確定バー単位で 1エントリーまで
   if(g_tf[0].lastBar == g_lastEntryBar) return;
   if(CountMyPos() >= InpMaxPos) return;
   if(!IsTradeTime()) return;

   // スプレッドフィルター
   if((long)InpMaxSpread_Pts > 0 &&
      SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > (long)InpMaxSpread_Pts)
      return;

   // Trigger TF: クロス検出 (方向フィルター適用)
   bool trigBuy  = (InpDir != DIR_SHORT_ONLY) &&
                   (g_tf[0].a0Prev <= InpBuyThresh  && g_tf[0].a0Curr > InpBuyThresh);
   bool trigSell = (InpDir != DIR_LONG_ONLY) &&
                   (g_tf[0].a0Prev >= InpSellThresh && g_tf[0].a0Curr < InpSellThresh);

   if(!trigBuy && !trigSell) return;

   // Mid / High TF: 同方向確認
   bool confBuy  = (g_tf[1].a0Curr > InpBuyThresh  && g_tf[2].a0Curr > InpBuyThresh);
   bool confSell = (g_tf[1].a0Curr < InpSellThresh && g_tf[2].a0Curr < InpSellThresh);

   // 動的 SL/TP (中央値 × 乗数)
   double medH  = CalcMedianHeight();
   if(medH <= 0.0) return;
   double slPts = MathMax(medH * InpSLZ, InpMinSL_Pts * _Point);

   if(trigBuy && confBuy)
   {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      if(g_trade.Buy(InpLot, _Symbol, ask, ask - slPts, ask + slPts, "VGRSI_GOLD_BUY"))
         g_lastEntryBar = g_tf[0].lastBar;
   }
   else if(trigSell && confSell)
   {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(g_trade.Sell(InpLot, _Symbol, bid, bid + slPts, bid - slPts, "VGRSI_GOLD_SELL"))
         g_lastEntryBar = g_tf[0].lastBar;
   }
}
//+------------------------------------------------------------------+
