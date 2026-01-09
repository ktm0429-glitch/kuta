//+------------------------------------------------------------------+
//|                                    kutaGOLD5.2_2Logic_v19.mq5    |
//|                        Copyright 2025, Titan FX XAUUSD Specialist|
//+------------------------------------------------------------------+
#property copyright "Copyright 2025, User & Claude AI"
#property version   "19.00"
#property strict

#include <Trade\Trade.mqh>

//--- Input Parameters ---
input group "=== General Settings ==="
input int    InpMaxSpread = 30;              // Reduced for better entry quality
input double InpFixedLot  = 0.01;
input bool   InpUseTimeFilter = true;        // Avoid Asian low volatility
input bool   InpUseDynamicSLTP = true;       // ATR-based stops
input bool   InpShowStats = true;            // Show statistics on exit

//--- LOGIC A: SWING (H1 / Long-Term) - ENHANCED ---
input group "=== Logic A: Swing (H1 Trend) - Enhanced ==="
input bool   InpEnableA   = true;
input int    InpMagicA    = 5211111;
input double InpLotA      = 0.01;
input int    InpSL_A      = 800;             // Better risk management
input int    InpTP_A      = 2000;            // Improved R:R ratio (1:2.5)
input int    InpADX_ThrA  = 18;              // Stronger trend requirement
input int    InpRSI_OB    = 70;              // RSI overbought level
input int    InpRSI_OS    = 30;              // RSI oversold level
input int    InpTrailStartA = 500;
input int    InpTrailDistA  = 80;
input int    InpMinTrendBars = 3;            // Trend confirmation bars

//--- LOGIC C: SMC IMPULSE (M5 / Short-Term) - ENHANCED ---
input group "=== Logic C: SMC Imbalance - Enhanced ==="
input bool   InpEnableC   = true;
input int    InpMagicC    = 5233333;
input double InpLotC      = 0.01;
input int    InpSL_C      = 500;             // Tighter stop loss
input int    InpTP_C      = 1200;            // Better R:R ratio (1:2.4)
input int    InpMinBody   = 300;             // Stronger impulse requirement
input double InpBodyRatio = 0.6;             // Body must be 60% of candle
input int    InpTrailStartC = 400;
input int    InpTrailDistC  = 120;
input int    InpCooldownBars = 5;            // Bars between trades

//--- Global Objects ---
CTrade tradeA, tradeC;
int handleMA_H1, handleADX_H1, handleRSI_H1, handleATR_H1, handleMA20_M5;
datetime lastBarTime_M5;
datetime lastTradeTime_A = 0;
datetime lastTradeTime_C = 0;

//--- Statistics Tracking ---
struct LogicStats {
   // Overall
   int totalTrades;
   int winTrades;
   int lossTrades;
   double totalProfit;
   double totalLoss;

   // Long
   int longTrades;
   int longWins;
   double longProfit;
   double longLoss;

   // Short
   int shortTrades;
   int shortWins;
   double shortProfit;
   double shortLoss;

   // Drawdown
   double maxBalance;
   double maxDD;
};

LogicStats statsA, statsC;

//+------------------------------------------------------------------+
//| Utility Functions                                                |
//+------------------------------------------------------------------+
double LotOrFixed(double lot)
{
   if(lot > 0.0) return lot;
   if(InpFixedLot > 0.0) return InpFixedLot;
   return 0.01;
}

//--- Time Filter: Avoid Asian low volatility session
bool IsGoodTradingTime()
{
   if(!InpUseTimeFilter) return true;

   MqlDateTime dt;
   TimeToStruct(TimeCurrent(), dt);
   int hour = dt.hour;

   // Avoid 0-6 GMT (Asian session low volatility)
   if(hour >= 0 && hour <= 6) return false;

   return true;
}

//--- Dynamic SL/TP based on ATR
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

   double atr_value = atr[0] / _Point;

   // SL = 0.8 * ATR, TP = 2.5 * ATR
   sl_points = MathMax(base_sl * _Point, atr_value * 0.8 * _Point);
   tp_points = MathMax(base_tp * _Point, atr_value * 2.5 * _Point);
}

//--- Update Statistics
void UpdateStats(LogicStats &stats, bool isLong, double profit)
{
   stats.totalTrades++;

   if(isLong)
   {
      stats.longTrades++;
      if(profit > 0)
      {
         stats.longWins++;
         stats.longProfit += profit;
         stats.winTrades++;
         stats.totalProfit += profit;
      }
      else
      {
         stats.longLoss += MathAbs(profit);
         stats.lossTrades++;
         stats.totalLoss += MathAbs(profit);
      }
   }
   else // Short
   {
      stats.shortTrades++;
      if(profit > 0)
      {
         stats.shortWins++;
         stats.shortProfit += profit;
         stats.winTrades++;
         stats.totalProfit += profit;
      }
      else
      {
         stats.shortLoss += MathAbs(profit);
         stats.lossTrades++;
         stats.totalLoss += MathAbs(profit);
      }
   }

   // Update balance and DD
   double currentBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   if(currentBalance > stats.maxBalance)
      stats.maxBalance = currentBalance;

   double currentDD = stats.maxBalance - currentBalance;
   if(currentDD > stats.maxDD)
      stats.maxDD = currentDD;
}

//--- Print Statistics
void PrintStatistics(string logicName, LogicStats &stats)
{
   if(!InpShowStats || stats.totalTrades == 0) return;

   double winRate = (stats.totalTrades > 0) ? (double)stats.winTrades / stats.totalTrades * 100.0 : 0;
   double longWinRate = (stats.longTrades > 0) ? (double)stats.longWins / stats.longTrades * 100.0 : 0;
   double shortWinRate = (stats.shortTrades > 0) ? (double)stats.shortWins / stats.shortTrades * 100.0 : 0;

   double netProfit = stats.totalProfit - stats.totalLoss;
   double pf = (stats.totalLoss > 0) ? stats.totalProfit / stats.totalLoss : 0;

   Print("========================================");
   Print("=== ", logicName, " Statistics ===");
   Print("========================================");
   Print("OVERALL:");
   Print("  Total Trades: ", stats.totalTrades);
   Print("  Win Rate: ", DoubleToString(winRate, 2), "%");
   Print("  Net Profit: $", DoubleToString(netProfit, 2));
   Print("  Profit Factor: ", DoubleToString(pf, 2));
   Print("  Max Drawdown: $", DoubleToString(stats.maxDD, 2));
   Print("");
   Print("LONG:");
   Print("  Trades: ", stats.longTrades);
   Print("  Wins: ", stats.longWins);
   Print("  Win Rate: ", DoubleToString(longWinRate, 2), "%");
   Print("  Profit: $", DoubleToString(stats.longProfit, 2));
   Print("  Loss: $", DoubleToString(stats.longLoss, 2));
   Print("  Net: $", DoubleToString(stats.longProfit - stats.longLoss, 2));
   Print("");
   Print("SHORT:");
   Print("  Trades: ", stats.shortTrades);
   Print("  Wins: ", stats.shortWins);
   Print("  Win Rate: ", DoubleToString(shortWinRate, 2), "%");
   Print("  Profit: $", DoubleToString(stats.shortProfit, 2));
   Print("  Loss: $", DoubleToString(stats.shortLoss, 2));
   Print("  Net: $", DoubleToString(stats.shortProfit - stats.shortLoss, 2));
   Print("========================================");
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

   if(handleMA_H1 == INVALID_HANDLE || handleADX_H1 == INVALID_HANDLE ||
      handleRSI_H1 == INVALID_HANDLE || handleATR_H1 == INVALID_HANDLE ||
      handleMA20_M5 == INVALID_HANDLE)
   {
      Print("Failed to create indicators");
      return(INIT_FAILED);
   }

   tradeA.SetExpertMagicNumber(InpMagicA);
   tradeA.SetTypeFilling(ORDER_FILLING_IOC);

   tradeC.SetExpertMagicNumber(InpMagicC);
   tradeC.SetTypeFilling(ORDER_FILLING_IOC);

   // Initialize stats
   ZeroMemory(statsA);
   ZeroMemory(statsC);
   statsA.maxBalance = AccountInfoDouble(ACCOUNT_BALANCE);
   statsC.maxBalance = AccountInfoDouble(ACCOUNT_BALANCE);

   Print("kutaGOLD5.2 2Logic v19 initialized successfully");
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

   // Print final statistics
   if(InpEnableA) PrintStatistics("Logic A (ALogic)", statsA);
   if(InpEnableC) PrintStatistics("Logic C (CLogic)", statsC);
}

//+------------------------------------------------------------------+
//| OnTick                                                           |
//+------------------------------------------------------------------+
void OnTick()
{
   // Check for closed positions and update stats
   CheckClosedPositions();

   // Manage trailing stops
   ManageTrailing(InpMagicA, tradeA, InpTrailStartA, InpTrailDistA);
   ManageTrailing(InpMagicC, tradeC, InpTrailStartC, InpTrailDistC);

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
}

//+------------------------------------------------------------------+
//| Check Closed Positions                                          |
//+------------------------------------------------------------------+
void CheckClosedPositions()
{
   static ulong lastDeals[];
   static int lastDealsSize = 0;

   HistorySelect(0, TimeCurrent());
   int dealsTotal = HistoryDealsTotal();

   if(dealsTotal > lastDealsSize)
   {
      for(int i = lastDealsSize; i < dealsTotal; i++)
      {
         ulong ticket = HistoryDealGetTicket(i);
         if(ticket == 0) continue;

         if(HistoryDealGetString(ticket, DEAL_SYMBOL) != _Symbol) continue;

         long magic = HistoryDealGetInteger(ticket, DEAL_MAGIC);
         long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);

         if(entry != DEAL_ENTRY_OUT) continue; // Only closing trades

         long type = HistoryDealGetInteger(ticket, DEAL_TYPE);
         double profit = HistoryDealGetDouble(ticket, DEAL_PROFIT);

         bool isLong = (type == DEAL_TYPE_BUY);

         if(magic == InpMagicA)
         {
            UpdateStats(statsA, isLong, profit);
         }
         else if(magic == InpMagicC)
         {
            UpdateStats(statsC, isLong, profit);
         }
      }
   }

   lastDealsSize = dealsTotal;
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
      if(tradeA.Buy(lot, _Symbol, ask, ask - sl_points, ask + tp_points, "kutaGOLD5.2 ALogic"))
      {
         lastTradeTime_A = TimeCurrent();
         Print("Logic A BUY: RSI=", rsi[0], " ADX=", adx[0]);
      }
   }
   // SELL: Strong downtrend + RSI not oversold
   else if(bearish_trend && rsi[0] > InpRSI_OS)
   {
      if(tradeA.Sell(lot, _Symbol, bid, bid + sl_points, bid - tp_points, "kutaGOLD5.2 ALogic"))
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

   // Cooldown (InpCooldownBars * 5 minutes)
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
      if(tradeC.Buy(lot, _Symbol, ask, ask - sl_points, ask + tp_points, "kutaGOLD5.2 CLogic"))
      {
         lastTradeTime_C = TimeCurrent();
         Print("Logic C BUY: Body=", body/_Point, " Ratio=", body_ratio);
      }
   }
   // SELL: Strong bearish impulse + price below MA20
   else if(close_[0] < open_[0] && close_[0] < ma20[0])
   {
      if(tradeC.Sell(lot, _Symbol, bid, bid + sl_points, bid - tp_points, "kutaGOLD5.2 CLogic"))
      {
         lastTradeTime_C = TimeCurrent();
         Print("Logic C SELL: Body=", body/_Point, " Ratio=", body_ratio);
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
