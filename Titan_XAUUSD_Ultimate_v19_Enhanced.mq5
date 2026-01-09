//+------------------------------------------------------------------+
//|                           Titan_XAUUSD_Ultimate_v19_Enhanced.mq5 |
//|                        Copyright 2025, Titan FX XAUUSD Specialist|
//|                                    Enhanced with AI Optimization |
//+------------------------------------------------------------------+
#property copyright "Copyright 2025, User & Claude AI"
#property version   "19.00"
#property strict

#include <Trade\Trade.mqh>

//--- Input Parameters ---
input group "=== General Settings ==="
input int    InpMaxSpread = 30;              // Reduced from 40 for better entry quality
input double InpFixedLot  = 0.01;
input bool   InpUseTimeFilter = true;        // NEW: Avoid low volatility periods
input bool   InpUseDynamicSLTP = true;       // NEW: ATR-based stops

//--- LOGIC A: SWING (H1 / Long-Term) - ENHANCED ---
input group "=== Logic A: Swing (H1 Trend) - Enhanced ==="
input bool   InpEnableA   = true;
input int    InpMagicA    = 11111;
input double InpLotA      = 0.01;
input int    InpSL_A      = 800;             // Tighter initial SL
input int    InpTP_A      = 2000;            // Better R:R ratio (1:2.5)
input int    InpADX_ThrA  = 18;              // Higher threshold for stronger trends
input int    InpRSI_OB    = 70;              // NEW: RSI overbought
input int    InpRSI_OS    = 30;              // NEW: RSI oversold
input int    InpTrailStartA = 500;
input int    InpTrailDistA  = 80;
input int    InpMinTrendBars = 3;            // NEW: Confirm trend strength

//--- LOGIC C: SMC IMPULSE (M5 / Short-Term) - ENHANCED ---
input group "=== Logic C: SMC Imbalance - Enhanced ==="
input bool   InpEnableC   = true;
input int    InpMagicC    = 33333;
input double InpLotC      = 0.01;
input int    InpSL_C      = 500;             // Reduced SL
input int    InpTP_C      = 1200;            // Better R:R (1:2.4)
input int    InpMinBody   = 300;             // Stronger impulse requirement
input double InpBodyRatio = 0.6;             // NEW: Body must be 60% of candle
input int    InpTrailStartC = 400;
input int    InpTrailDistC  = 120;
input int    InpCooldownBars = 5;            // NEW: Prevent overtrading

//--- NEW LOGIC D: VOLUME SPIKE REVERSAL ---
input group "=== Logic D: Volume Spike Reversal ==="
input bool   InpEnableD   = true;
input int    InpMagicD    = 44444;
input double InpLotD      = 0.01;
input int    InpSL_D      = 600;
input int    InpTP_D      = 1500;
input double InpVolumeMult = 2.0;            // Volume must be 2x average
input int    InpTrailStartD = 450;
input int    InpTrailDistD  = 100;

//--- Global Objects ---
CTrade tradeA, tradeC, tradeD;
int handleMA_H1, handleADX_H1, handleRSI_H1, handleATR_H1;
int handleMA20_M5, handleVolume_M5;
datetime lastBarTime_M5;
datetime lastTradeTime_A = 0;
datetime lastTradeTime_C = 0;
datetime lastTradeTime_D = 0;

//+------------------------------------------------------------------+
//| Utility Functions                                                 |
//+------------------------------------------------------------------+
double LotOrFixed(double lot)
{
   if(lot > 0.0) return lot;
   if(InpFixedLot > 0.0) return InpFixedLot;
   return 0.01;
}

//--- NEW: Time Filter (Avoid Asian low volatility)
bool IsGoodTradingTime()
{
   if(!InpUseTimeFilter) return true;

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int hour = dt.hour;

   // Avoid 0-6 GMT (Asian session low volatility)
   // Focus on London (7-16) and NY (13-22) overlap
   if(hour >= 1 && hour <= 6) return false;

   return true;
}

//--- NEW: Dynamic SL/TP based on ATR
void GetDynamicSLTP(int base_sl, int base_tp, double &sl_points, double &tp_points)
{
   if(!InpUseDynamicSLTP)
   {
      sl_points = base_sl * _Point;
      tp_points = base_tp * _Point;
      return;
   }

   double atr[];
   ArraySetAsSeries(atr, true);
   if(CopyBuffer(handleATR_H1, 0, 1, 1, atr) < 1)
   {
      sl_points = base_sl * _Point;
      tp_points = base_tp * _Point;
      return;
   }

   double atr_points = atr[0] / _Point;

   // SL = 0.8 * ATR, TP = 2.0 * ATR (minimum 1:2.5 R:R)
   sl_points = MathMax(base_sl * _Point, atr_points * 0.8 * _Point);
   tp_points = MathMax(base_tp * _Point, atr_points * 2.5 * _Point);
}

//+------------------------------------------------------------------+
//| OnInit                                                           |
//+------------------------------------------------------------------+
int OnInit()
{
   handleMA_H1  = iMA(_Symbol, PERIOD_H1, 200, 0, MODE_EMA, PRICE_CLOSE);
   handleADX_H1 = iADX(_Symbol, PERIOD_H1, 14);
   handleRSI_H1 = iRSI(_Symbol, PERIOD_H1, 14, PRICE_CLOSE);
   handleATR_H1 = iATR(_Symbol, PERIOD_H1, 14);
   handleMA20_M5 = iMA(_Symbol, PERIOD_M5, 20, 0, MODE_SMA, PRICE_CLOSE);
   handleVolume_M5 = iVolumes(_Symbol, PERIOD_M5, VOLUME_TICK);

   if(handleMA_H1 == INVALID_HANDLE || handleADX_H1 == INVALID_HANDLE ||
      handleRSI_H1 == INVALID_HANDLE || handleATR_H1 == INVALID_HANDLE ||
      handleMA20_M5 == INVALID_HANDLE || handleVolume_M5 == INVALID_HANDLE)
   {
      Print("Failed to create indicators");
      return(INIT_FAILED);
   }

   tradeA.SetExpertMagicNumber(InpMagicA);
   tradeA.SetTypeFilling(ORDER_FILLING_IOC);

   tradeC.SetExpertMagicNumber(InpMagicC);
   tradeC.SetTypeFilling(ORDER_FILLING_IOC);

   tradeD.SetExpertMagicNumber(InpMagicD);
   tradeD.SetTypeFilling(ORDER_FILLING_IOC);

   Print("Titan XAUUSD Enhanced v19 initialized successfully");
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| OnDeinit                                                         |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   IndicatorRelease(handleMA_H1);
   IndicatorRelease(handleADX_H1);
   IndicatorRelease(handleRSI_H1);
   IndicatorRelease(handleATR_H1);
   IndicatorRelease(handleMA20_M5);
   IndicatorRelease(handleVolume_M5);
}

//+------------------------------------------------------------------+
//| OnTick                                                           |
//+------------------------------------------------------------------+
void OnTick()
{
   // Manage trailing stops for all logics
   ManageTrailing(InpMagicA, tradeA, InpTrailStartA, InpTrailDistA);
   ManageTrailing(InpMagicC, tradeC, InpTrailStartC, InpTrailDistC);
   ManageTrailing(InpMagicD, tradeD, InpTrailStartD, InpTrailDistD);

   // Spread filter
   if(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > InpMaxSpread) return;

   // Time filter
   if(!IsGoodTradingTime()) return;

   // New bar check (M5)
   datetime currentTime = iTime(_Symbol, PERIOD_M5, 0);
   if(currentTime == lastBarTime_M5) return;
   lastBarTime_M5 = currentTime;

   // Execute trading logics
   if(InpEnableA) Logic_A_Swing_Enhanced();
   if(InpEnableC) Logic_C_SMC_Enhanced();
   if(InpEnableD) Logic_D_VolumeReversal();
}

//+------------------------------------------------------------------+
//| Logic A: Enhanced Swing Trading                                  |
//+------------------------------------------------------------------+
void Logic_A_Swing_Enhanced()
{
   // Position limit
   if(CountPositions(InpMagicA) > 0) return;

   // Cooldown between trades (1 hour minimum)
   if(TimeCurrent() - lastTradeTime_A < 3600) return;

   double ma[], adx[], rsi[], close_[];
   ArrayResize(ma, InpMinTrendBars + 1);
   ArrayResize(adx, 2);
   ArrayResize(rsi, 2);
   ArrayResize(close_, InpMinTrendBars + 1);
   ArraySetAsSeries(ma, true);
   ArraySetAsSeries(adx, true);
   ArraySetAsSeries(rsi, true);
   ArraySetAsSeries(close_, true);

   if(CopyBuffer(handleMA_H1, 0, 1, InpMinTrendBars + 1, ma) < InpMinTrendBars + 1) return;
   if(CopyBuffer(handleADX_H1, 0, 1, 2, adx) < 2) return;
   if(CopyBuffer(handleRSI_H1, 0, 1, 2, rsi) < 2) return;
   if(CopyClose(_Symbol, PERIOD_H1, 1, InpMinTrendBars + 1, close_) < InpMinTrendBars + 1) return;

   // Strong trend requirement
   if(adx[0] < InpADX_ThrA) return;

   // Confirm trend consistency for multiple bars
   bool bullish_trend = true;
   bool bearish_trend = true;

   for(int i = 0; i < InpMinTrendBars; i++)
   {
      if(close_[i] <= ma[i]) bullish_trend = false;
      if(close_[i] >= ma[i]) bearish_trend = false;
   }

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double lot = LotOrFixed(InpLotA);

   double sl_points, tp_points;
   GetDynamicSLTP(InpSL_A, InpTP_A, sl_points, tp_points);

   // BUY: Strong uptrend + RSI not overbought
   if(bullish_trend && rsi[0] < InpRSI_OB)
   {
      if(tradeA.Buy(lot, _Symbol, ask, ask - sl_points, ask + tp_points, "TitanV19_LogicA_BUY"))
      {
         lastTradeTime_A = TimeCurrent();
         Print("Logic A BUY: RSI=", rsi[0], " ADX=", adx[0]);
      }
   }
   // SELL: Strong downtrend + RSI not oversold
   else if(bearish_trend && rsi[0] > InpRSI_OS)
   {
      if(tradeA.Sell(lot, _Symbol, bid, bid + sl_points, bid - tp_points, "TitanV19_LogicA_SELL"))
      {
         lastTradeTime_A = TimeCurrent();
         Print("Logic A SELL: RSI=", rsi[0], " ADX=", adx[0]);
      }
   }
}

//+------------------------------------------------------------------+
//| Logic C: Enhanced SMC Impulse                                    |
//+------------------------------------------------------------------+
void Logic_C_SMC_Enhanced()
{
   // Position limit
   if(CountPositions(InpMagicC) > 0) return;

   // Cooldown (5 M5 bars = 25 minutes)
   if(TimeCurrent() - lastTradeTime_C < InpCooldownBars * 300) return;

   double open_[], high_[], low_[], close_[], ma20[];
   ArrayResize(open_, 2);
   ArrayResize(high_, 2);
   ArrayResize(low_, 2);
   ArrayResize(close_, 2);
   ArrayResize(ma20, 2);
   ArraySetAsSeries(open_, true);
   ArraySetAsSeries(high_, true);
   ArraySetAsSeries(low_, true);
   ArraySetAsSeries(close_, true);
   ArraySetAsSeries(ma20, true);

   if(CopyOpen(_Symbol, PERIOD_M5, 1, 2, open_) < 2) return;
   if(CopyHigh(_Symbol, PERIOD_M5, 1, 2, high_) < 2) return;
   if(CopyLow(_Symbol, PERIOD_M5, 1, 2, low_) < 2) return;
   if(CopyClose(_Symbol, PERIOD_M5, 1, 2, close_) < 2) return;
   if(CopyBuffer(handleMA20_M5, 0, 1, 2, ma20) < 2) return;

   double body = MathAbs(close_[0] - open_[0]);
   double candle_range = high_[0] - low_[0];

   // Strong impulse requirements
   if(body < InpMinBody * _Point) return;
   if(candle_range == 0) return;

   double body_ratio = body / candle_range;
   if(body_ratio < InpBodyRatio) return; // Body must dominate the candle

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double lot = LotOrFixed(InpLotC);

   double sl_points, tp_points;
   GetDynamicSLTP(InpSL_C, InpTP_C, sl_points, tp_points);

   // BUY: Strong bullish impulse + price above MA20
   if(close_[0] > open_[0] && close_[0] > ma20[0])
   {
      if(tradeC.Buy(lot, _Symbol, ask, ask - sl_points, ask + tp_points, "TitanV19_LogicC_BUY"))
      {
         lastTradeTime_C = TimeCurrent();
         Print("Logic C BUY: Body=", body/_Point, " Ratio=", body_ratio);
      }
   }
   // SELL: Strong bearish impulse + price below MA20
   else if(close_[0] < open_[0] && close_[0] < ma20[0])
   {
      if(tradeC.Sell(lot, _Symbol, bid, bid + sl_points, bid - tp_points, "TitanV19_LogicC_SELL"))
      {
         lastTradeTime_C = TimeCurrent();
         Print("Logic C SELL: Body=", body/_Point, " Ratio=", body_ratio);
      }
   }
}

//+------------------------------------------------------------------+
//| Logic D: NEW - Volume Spike Reversal                            |
//+------------------------------------------------------------------+
void Logic_D_VolumeReversal()
{
   // Position limit
   if(CountPositions(InpMagicD) > 0) return;

   // Cooldown (30 minutes)
   if(TimeCurrent() - lastTradeTime_D < 1800) return;

   double volume[], close_[], open_[];
   ArrayResize(volume, 20);
   ArrayResize(close_, 3);
   ArrayResize(open_, 3);
   ArraySetAsSeries(volume, true);
   ArraySetAsSeries(close_, true);
   ArraySetAsSeries(open_, true);

   if(CopyBuffer(handleVolume_M5, 0, 1, 20, volume) < 20) return;
   if(CopyClose(_Symbol, PERIOD_M5, 1, 3, close_) < 3) return;
   if(CopyOpen(_Symbol, PERIOD_M5, 1, 3, open_) < 3) return;

   // Calculate average volume
   double avg_volume = 0;
   for(int i = 1; i < 20; i++) avg_volume += volume[i];
   avg_volume /= 19;

   // Volume spike on bar[1]
   if(volume[0] < avg_volume * InpVolumeMult) return;

   // Reversal pattern: bar[1] has volume spike, bar[0] reverses direction
   bool bullish_reversal = (close_[1] < open_[1]) && (close_[0] > open_[0]);
   bool bearish_reversal = (close_[1] > open_[1]) && (close_[0] < open_[0]);

   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double lot = LotOrFixed(InpLotD);

   if(bullish_reversal)
   {
      if(tradeD.Buy(lot, _Symbol, ask,
                    ask - InpSL_D * _Point,
                    ask + InpTP_D * _Point,
                    "TitanV19_LogicD_BUY"))
      {
         lastTradeTime_D = TimeCurrent();
         Print("Logic D BUY: Volume=", volume[0], " Avg=", avg_volume);
      }
   }
   else if(bearish_reversal)
   {
      if(tradeD.Sell(lot, _Symbol, bid,
                     bid + InpSL_D * _Point,
                     bid - InpTP_D * _Point,
                     "TitanV19_LogicD_SELL"))
      {
         lastTradeTime_D = TimeCurrent();
         Print("Logic D SELL: Volume=", volume[0], " Avg=", avg_volume);
      }
   }
}

//+------------------------------------------------------------------+
//| Helper Functions                                                 |
//+------------------------------------------------------------------+
int CountPositions(int magic)
{
   int count = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(!PositionSelectByTicket(tk)) continue;

      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == magic)
         count++;
   }
   return count;
}

void ManageTrailing(int magic, CTrade &ctrade, int start, int dist)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(!PositionSelectByTicket(tk)) continue;

      if(PositionGetString(POSITION_SYMBOL) != _Symbol ||
         PositionGetInteger(POSITION_MAGIC) != magic)
         continue;

      double sl = PositionGetDouble(POSITION_SL);
      double tp = PositionGetDouble(POSITION_TP);
      double price = PositionGetDouble(POSITION_PRICE_CURRENT);
      double openPrice = PositionGetDouble(POSITION_PRICE_OPEN);
      long type = PositionGetInteger(POSITION_TYPE);

      if(type == POSITION_TYPE_BUY && price - openPrice > start * _Point)
      {
         double newSL = price - dist * _Point;
         if(newSL > sl && newSL < price)
            ctrade.PositionModify(tk, newSL, tp);
      }
      else if(type == POSITION_TYPE_SELL && openPrice - price > start * _Point)
      {
         double newSL = price + dist * _Point;
         if((sl == 0 || newSL < sl) && newSL > price)
            ctrade.PositionModify(tk, newSL, tp);
      }
   }
}
//+------------------------------------------------------------------+
