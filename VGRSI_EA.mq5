//+------------------------------------------------------------------+
//| VGRSI_EA.mq5                                                      |
//| Expert Advisor based on VGRSI (arXiv:2605.01300, Rafał Rak)      |
//|                                                                    |
//| エントリーロジック:                                                  |
//|   TF_Trigger (M1): A0 がクロス（買いラインを上抜け / 売りラインを下抜け）|
//|   TF_Mid (M5):     A0 が同方向を確認                                |
//|   TF_High (M30):   A0 が同方向を確認                                |
//|   → 3TF 全て条件一致でエントリー                                     |
//|                                                                    |
//| SL/TP: 直近 N 本のローソク高さ中央値 × Z（対称設定）                  |
//| 最大同時ポジション: InpMaxPos                                         |
//| 1バーに1エントリー制限                                               |
//+------------------------------------------------------------------+
#property copyright "Based on arXiv:2605.01300"
#property link      "https://arxiv.org/abs/2605.01300"
#property version   "1.00"

#include <Trade\Trade.mqh>

//--- 入力パラメータ
input group "=== VGRSI パラメータ ==="
input int    InpWS           = 20;       // WS: 集計ウィンドウ
input int    InpWV           = 40;       // WV: 後方可視距離

input group "=== エントリー条件 ==="
input double InpBuyThresh    = 35.0;     // 買いクロスライン (A0 がこれを上抜け)
input double InpSellThresh   = 70.0;     // 売りクロスライン (A0 がこれを下抜け)

input group "=== マルチタイムフレーム ==="
input ENUM_TIMEFRAMES InpTF_Trigger = PERIOD_M1;   // トリガー TF: クロス検出
input ENUM_TIMEFRAMES InpTF_Mid     = PERIOD_M5;   // 中間 TF:    方向確認
input ENUM_TIMEFRAMES InpTF_High    = PERIOD_M30;  // 上位 TF:    トレンド確認

input group "=== SL/TP ==="
input int    InpSLN          = 20;       // SL/TP 算出に使うローソク本数
input double InpSLZ          = 2.0;      // SL/TP 乗数
input double InpMinSL_Pts    = 100;      // 最小 SL (ポイント)

input group "=== 資金管理 ==="
input double InpLot          = 0.1;      // ロットサイズ
input int    InpMaxPos       = 2;        // 最大同時ポジション数
input ulong  InpMagic        = 202600;   // マジックナンバー

//--- 内部構造体
struct TFState
{
   ENUM_TIMEFRAMES tf;
   datetime        lastBar;   // 最後に更新した確定バーの開始時刻
   double          a0Curr;    // bar[1]: 直近確定足の A0
   double          a0Prev;    // bar[2]: 1本前の A0
};

//--- グローバル変数
CTrade   g_trade;
TFState  g_tf[3];
datetime g_lastEntryBar = 0;   // 同一バー内の二重エントリー防止

//+------------------------------------------------------------------+
int OnInit()
{
   if(InpWS <= 0 || InpWV <= 0)
   {
      Print("VGRSI_EA: WS/WV は 1 以上にしてください");
      return INIT_PARAMETERS_INCORRECT;
   }

   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(30);

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
// AsSeries=true: iIdx > jIdx (i は過去、j は現在)
//+------------------------------------------------------------------+
bool IsVisible(const double &p[], int iIdx, int jIdx)
{
   if(iIdx - jIdx <= 1)
      return true;

   double span = (double)(iIdx - jIdx);
   for(int k = jIdx + 1; k < iIdx; k++)
   {
      double lv = p[jIdx] + (p[iIdx] - p[jIdx]) * (double)(k - jIdx) / span;
      if(p[k] >= lv)
         return false;
   }
   return true;
}

//+------------------------------------------------------------------+
// VGRSI A0 計算 (AsSeries=true の close 配列、barIndex=1 が直近確定足)
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
         if(iIdx + 1 >= total)
            break;

         if(IsVisible(price, iIdx, jIdx))
         {
            if(++vis > InpWS)
               break;

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
// TF キャッシュを更新 (新しい確定バーができたときのみ再計算)
//+------------------------------------------------------------------+
bool UpdateState(TFState &s)
{
   datetime bt[1];
   ArraySetAsSeries(bt, true);
   if(CopyTime(_Symbol, s.tf, 1, 1, bt) < 1)
      return false;

   if(bt[0] == s.lastBar)
      return true;   // 新バーなし → キャッシュそのまま使用

   int    needed = InpWS + InpWV + 4;
   double cls[];
   ArraySetAsSeries(cls, true);
   if(CopyClose(_Symbol, s.tf, 0, needed, cls) < needed)
      return false;

   s.a0Curr = CalcA0(cls, needed, 1);
   s.a0Prev = CalcA0(cls, needed, 2);
   s.lastBar = bt[0];
   return true;
}

//+------------------------------------------------------------------+
// 直近 InpSLN 本のローソク高さ中央値を返す
//+------------------------------------------------------------------+
double CalcMedianHeight()
{
   double h[], l[], ht[];
   ArraySetAsSeries(h, true);
   ArraySetAsSeries(l, true);

   if(CopyHigh(_Symbol, PERIOD_CURRENT, 1, InpSLN, h) < InpSLN) return 0.0;
   if(CopyLow (_Symbol, PERIOD_CURRENT, 1, InpSLN, l) < InpSLN) return 0.0;

   ArrayResize(ht, InpSLN);
   for(int i = 0; i < InpSLN; i++)
      ht[i] = h[i] - l[i];

   ArraySort(ht);

   int n = InpSLN;
   return (n % 2 == 1) ? ht[n / 2] : (ht[n / 2 - 1] + ht[n / 2]) / 2.0;
}

//+------------------------------------------------------------------+
// このEAが管理するポジション数を返す
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
void OnTick()
{
   // 全 TF キャッシュを更新
   for(int i = 0; i < 3; i++)
      if(!UpdateState(g_tf[i])) return;

   // Trigger TF の確定バー単位で1エントリーまで
   if(g_tf[0].lastBar == g_lastEntryBar)
      return;

   if(CountMyPos() >= InpMaxPos)
      return;

   //--- Trigger TF: A0 のクロスを検出
   bool trigBuy  = (g_tf[0].a0Prev <= InpBuyThresh  && g_tf[0].a0Curr > InpBuyThresh);
   bool trigSell = (g_tf[0].a0Prev >= InpSellThresh && g_tf[0].a0Curr < InpSellThresh);

   if(!trigBuy && !trigSell)
      return;

   //--- Mid / High TF: 同方向を確認
   bool confBuy  = (g_tf[1].a0Curr > InpBuyThresh  && g_tf[2].a0Curr > InpBuyThresh);
   bool confSell = (g_tf[1].a0Curr < InpSellThresh && g_tf[2].a0Curr < InpSellThresh);

   //--- 動的 SL/TP
   double medH  = CalcMedianHeight();
   if(medH <= 0.0) return;
   double slPts = MathMax(medH * InpSLZ, InpMinSL_Pts * _Point);

   //--- 発注
   if(trigBuy && confBuy)
   {
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      if(g_trade.Buy(InpLot, _Symbol, ask, ask - slPts, ask + slPts, "VGRSI_BUY"))
         g_lastEntryBar = g_tf[0].lastBar;
   }
   else if(trigSell && confSell)
   {
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      if(g_trade.Sell(InpLot, _Symbol, bid, bid + slPts, bid - slPts, "VGRSI_SELL"))
         g_lastEntryBar = g_tf[0].lastBar;
   }
}
//+------------------------------------------------------------------+
