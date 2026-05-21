//+------------------------------------------------------------------+
//| VGRSI.mq5 - Visibility Graphs Relative Strength Index            |
//| Based on: arXiv:2605.01300 (Rafał Rak, 2026)                     |
//| "Visibility graphs can make money in financial markets"           |
//+------------------------------------------------------------------+
#property copyright "Based on arXiv:2605.01300"
#property link      "https://arxiv.org/abs/2605.01300"
#property version   "1.01"
#property indicator_separate_window
#property indicator_minimum 0
#property indicator_maximum 100
#property indicator_buffers 2
#property indicator_plots   2

//--- Plot VGRSI A0
#property indicator_label1  "VGRSI_A0"
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrDodgerBlue
#property indicator_style1  STYLE_SOLID
#property indicator_width1  2

//--- Plot VGRSI A1
#property indicator_label2  "VGRSI_A1"
#property indicator_type2   DRAW_LINE
#property indicator_color2  clrOrange
#property indicator_style2  STYLE_SOLID
#property indicator_width2  1

//--- Input parameters
input group "=== A0: トレンド持続性フィルタ ==="
input int    InpA0_WS            = 20;   // A0 WS: 集計ウィンドウ (論文 Fig.2 デフォルト)
input int    InpA0_WV            = 40;   // A0 WV: 後方可視距離  (論文 Fig.2 デフォルト)

input group "=== A1: インパルス/レジーム変化検出 ==="
input int    InpA1_WS            = 15;   // A1 WS: 集計ウィンドウ (論文 Fig.2 デフォルト)
input int    InpA1_WV            = 100;  // A1 WV: 後方可視距離  (論文 Fig.2 デフォルト: 長期構造)

input group "=== シグナルライン ==="
input int    InpOverbought       = 70;   // 買われすぎライン
input int    InpOversold         = 30;   // 売られすぎライン
input bool   InpShowA1           = true; // A1(インパルスモード)を表示

//--- Indicator buffers
double BufferA0[];
double BufferA1[];

//--- Level lines
#property indicator_level1  70
#property indicator_level2  50
#property indicator_level3  30
#property indicator_levelcolor clrGray
#property indicator_levelstyle STYLE_DOT

//+------------------------------------------------------------------+
//| Custom indicator initialization function                          |
//+------------------------------------------------------------------+
int OnInit()
{
   if(InpA0_WS <= 0 || InpA0_WV <= 0 || InpA1_WS <= 0 || InpA1_WV <= 0)
   {
      Print("VGRSI: パラメータは全て 1 以上にしてください");
      return(INIT_PARAMETERS_INCORRECT);
   }

   SetIndexBuffer(0, BufferA0, INDICATOR_DATA);
   SetIndexBuffer(1, BufferA1, INDICATOR_DATA);

   ArraySetAsSeries(BufferA0, true);
   ArraySetAsSeries(BufferA1, true);

   IndicatorSetString(INDICATOR_SHORTNAME,
      StringFormat("VGRSI A0(%d,%d) A1(%d,%d)",
                   InpA0_WS, InpA0_WV, InpA1_WS, InpA1_WV));

   IndicatorSetInteger(INDICATOR_DIGITS, 2);

   IndicatorSetInteger(INDICATOR_LEVELS, 3);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 0, InpOverbought);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 1, 50);
   IndicatorSetDouble(INDICATOR_LEVELVALUE, 2, InpOversold);

   PlotIndexSetInteger(1, PLOT_DRAW_TYPE, InpShowA1 ? DRAW_LINE : DRAW_NONE);

   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| 点 iIdx が点 jIdx から「見える」かどうかを判定                        |
//| AsSeries=true: iIdx > jIdx (i は過去、j は現在)                    |
//| 間の全ての k が (j,i) を結ぶ直線より厳密に下にあれば可視              |
//+------------------------------------------------------------------+
bool IsVisible(const double &price[], int iIdx, int jIdx)
{
   if(iIdx - jIdx <= 1)
      return true;

   double pi = price[iIdx];
   double pj = price[jIdx];
   double span = (double)(iIdx - jIdx);

   for(int k = jIdx + 1; k < iIdx; k++)
   {
      double lineValue = pj + (pi - pj) * (double)(k - jIdx) / span;
      if(price[k] >= lineValue)
         return false;
   }
   return true;
}

//+------------------------------------------------------------------+
//| 指定バーの VGRSI 値を計算                                           |
//| ws: 集計ウィンドウ, wv: 後方可視距離                                 |
//+------------------------------------------------------------------+
double CalcVGRSI(const double &price[], int barIndex, int totalBars,
                 int ws, int wv)
{
   double sumPlus  = 0.0;
   double sumMinus = 0.0;
   int    cntPlus  = 0;
   int    cntMinus = 0;

   // 外ループ: j ∈ {t, t-1, ..., t-WS+1} (AsSeries: barIndex 〜 barIndex+ws-1)
   for(int jOff = 0; jOff < ws; jOff++)
   {
      int jIdx = barIndex + jOff;
      int visibleCount = 0;

      // 内ループ: j から過去 WV 本以内の可視点を最大 WS 個集める
      for(int iOff = 1; iOff <= wv; iOff++)
      {
         int iIdx = jIdx + iOff;
         if(iIdx + 1 >= totalBars)
            break;

         if(IsVisible(price, iIdx, jIdx))
         {
            visibleCount++;
            if(visibleCount > ws)
               break;

            // Δpi = pi - p(i-1): AsSeries では i-1 が iIdx+1
            double delta = price[iIdx] - price[iIdx + 1];

            if(delta > 0.0)
            {
               sumPlus  += delta;
               cntPlus++;
            }
            else if(delta < 0.0)
            {
               sumMinus += -delta;
               cntMinus++;
            }
         }
      }
   }

   // エッジケース処理
   if(sumMinus <= 0.0 || cntMinus <= 0) return 100.0;
   if(sumPlus  <= 0.0 || cntPlus  <= 0) return 0.0;

   double rS = sumPlus  / sumMinus;
   double rN = (double)cntPlus / (double)cntMinus;

   return 0.0; // 呼び出し元で A0/A1 を分岐するためダミー (下記で計算)
}

//+------------------------------------------------------------------+
//| A0 / A1 を別パラで計算してバッファへ書き込む                          |
//+------------------------------------------------------------------+
void ComputeBar(const double &price[], int barIndex, int totalBars)
{
   // --- A0: WS=InpA0_WS, WV=InpA0_WV ---
   {
      int ws = InpA0_WS;
      int wv = InpA0_WV;
      double sumPlus=0, sumMinus=0; int cntPlus=0, cntMinus=0;

      for(int jOff = 0; jOff < ws; jOff++)
      {
         int jIdx = barIndex + jOff;
         int visibleCount = 0;
         for(int iOff = 1; iOff <= wv; iOff++)
         {
            int iIdx = jIdx + iOff;
            if(iIdx + 1 >= totalBars) break;
            if(IsVisible(price, iIdx, jIdx))
            {
               if(++visibleCount > ws) break;
               double d = price[iIdx] - price[iIdx + 1];
               if(d > 0.0){ sumPlus  += d; cntPlus++; }
               else if(d < 0.0){ sumMinus += -d; cntMinus++; }
            }
         }
      }

      if(sumMinus <= 0.0 || cntMinus <= 0)      BufferA0[barIndex] = 100.0;
      else if(sumPlus <= 0.0 || cntPlus <= 0)   BufferA0[barIndex] = 0.0;
      else
      {
         double rS = sumPlus / sumMinus;
         double rN = (double)cntPlus / (double)cntMinus;
         double rA0 = (rS + rN) / 2.0;
         BufferA0[barIndex] = 100.0 - 100.0 / (1.0 + rA0);
      }
   }

   // --- A1: WS=InpA1_WS, WV=InpA1_WV ---
   if(InpShowA1)
   {
      int ws = InpA1_WS;
      int wv = InpA1_WV;
      double sumPlus=0, sumMinus=0; int cntPlus=0, cntMinus=0;

      for(int jOff = 0; jOff < ws; jOff++)
      {
         int jIdx = barIndex + jOff;
         int visibleCount = 0;
         for(int iOff = 1; iOff <= wv; iOff++)
         {
            int iIdx = jIdx + iOff;
            if(iIdx + 1 >= totalBars) break;
            if(IsVisible(price, iIdx, jIdx))
            {
               if(++visibleCount > ws) break;
               double d = price[iIdx] - price[iIdx + 1];
               if(d > 0.0){ sumPlus  += d; cntPlus++; }
               else if(d < 0.0){ sumMinus += -d; cntMinus++; }
            }
         }
      }

      if(sumMinus <= 0.0 || cntMinus <= 0)      BufferA1[barIndex] = 100.0;
      else if(sumPlus <= 0.0 || cntPlus <= 0)   BufferA1[barIndex] = 0.0;
      else
      {
         double rS = sumPlus / sumMinus;
         double rN = (double)cntPlus / (double)cntMinus;
         double rA1 = (rN > 0.0) ? (rS / rN) : rS;
         BufferA1[barIndex] = 100.0 - 100.0 / (1.0 + rA1);
      }
   }
   else
   {
      BufferA1[barIndex] = EMPTY_VALUE;
   }
}

//+------------------------------------------------------------------+
//| Custom indicator iteration function                               |
//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
{
   ArraySetAsSeries(close, true);

   // A0/A1 それぞれの必要バー数の大きい方で制限
   int neededA0 = InpA0_WS + InpA0_WV + 2;
   int neededA1 = InpA1_WS + InpA1_WV + 2;
   int needed   = MathMax(neededA0, neededA1);

   if(rates_total < needed)
      return 0;

   int maxBar = rates_total - needed;
   int limit;

   if(prev_calculated == 0)
   {
      ArrayInitialize(BufferA0, EMPTY_VALUE);
      ArrayInitialize(BufferA1, EMPTY_VALUE);
      limit = maxBar;
   }
   else
   {
      limit = MathMin(rates_total - prev_calculated + 1, maxBar);
   }

   for(int i = 0; i <= limit; i++)
      ComputeBar(close, i, rates_total);

   return(rates_total);
}
//+------------------------------------------------------------------+
