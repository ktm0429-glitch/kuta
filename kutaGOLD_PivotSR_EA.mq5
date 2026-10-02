//+------------------------------------------------------------------+
//| kutaGOLD_PivotSR_EA.mq5                                          |
//| Pivot + auto horizontal-line (confluence) EA for XAUUSD / M15    |
//+------------------------------------------------------------------+
#property copyright "kuta"
#property version   "0.10"
#property description "Daily pivot + prev H/L + round numbers + swing clusters."
#property description "Zones where >= InpMinSources sources overlap are drawn as H-lines and traded."
#property description "Range (ADX low) = bounce / Trend (ADX high) = breakout."

#include <Trade/Trade.mqh>

//--- source bits
#define SRC_PIVOT  1
#define SRC_PREVHL 2
#define SRC_ROUND  4
#define SRC_SWING  8
#define SRC_MULTI  16   // swing zone touched 2+ times

//--- inputs
input group "=== General ===";
input long   InpMagic        = 20251002;
input double InpLots         = 0.10;
input int    InpMaxSpread    = 50;      // points
input int    InpCooldownSec  = 60;
input int    InpDeviation    = 30;      // points

input group "=== Indicators ===";
input int    InpATRPeriod    = 14;
input int    InpADXPeriod    = 14;
input double InpADXTrend     = 25.0;    // ADX >= : breakout mode, else bounce mode

input group "=== Levels ===";
input double InpRoundStep    = 10.0;    // round number step (price units)
input int    InpRoundCount   = 4;       // steps above/below price
input int    InpSwingBars    = 400;     // M15 bars scanned for swings
input int    InpSwingStrength= 5;       // bars each side for a swing point
input double InpZoneATR      = 0.30;    // cluster width = ATR * this
input int    InpMinSources   = 2;       // distinct sources needed for a valid zone
input bool   InpUsePivot     = true;
input bool   InpUsePrevHL    = true;
input bool   InpUseRound     = true;
input bool   InpUseSwing     = true;

input group "=== Entry / Exit ===";
input bool   InpTradeBounce  = true;
input bool   InpTradeBreak   = true;
input double InpSLBufATR     = 0.50;    // SL buffer beyond zone (bounce)
input double InpBreakSLATR   = 1.00;    // SL distance from zone (breakout)
input double InpBreakConfATR = 0.10;    // breakout close must exceed zone by ATR*this
input double InpTPFallbackATR= 2.00;    // TP when no next zone exists
input double InpMinRR        = 1.0;     // skip trade if reward/risk below this

input group "=== Drawing ===";
input bool   InpDrawLines    = true;
input color  InpColorWeak    = clrDimGray;
input color  InpColorStrong  = clrGold;

//--- types
struct SLevel
  {
   double price;
   double score;
   int    mask;
   int    swingCount;
  };

//--- globals
CTrade   g_trade;
int      g_atrHandle = INVALID_HANDLE;
int      g_adxHandle = INVALID_HANDLE;
datetime g_lastBar   = 0;
datetime g_lastEntry = 0;
SLevel   g_raw[];
SLevel   g_zones[];
string   g_prefix    = "kPSR_";

//+------------------------------------------------------------------+
int OnInit()
  {
   g_atrHandle = iATR(_Symbol, _Period, InpATRPeriod);
   g_adxHandle = iADX(_Symbol, _Period, InpADXPeriod);
   if(g_atrHandle == INVALID_HANDLE || g_adxHandle == INVALID_HANDLE)
      return INIT_FAILED;
   if(_Period != PERIOD_M15)
      Print("Warning: designed for M15, current period differs.");
   g_trade.SetExpertMagicNumber(InpMagic);
   g_trade.SetDeviationInPoints(InpDeviation);
   g_trade.SetTypeFillingBySymbol(_Symbol);
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   IndicatorRelease(g_atrHandle);
   IndicatorRelease(g_adxHandle);
   ObjectsDeleteAll(0, g_prefix);
  }

//+------------------------------------------------------------------+
//| Level collection                                                 |
//+------------------------------------------------------------------+
void AddRaw(const double price, const double weight, const int src)
  {
   int n = ArraySize(g_raw);
   ArrayResize(g_raw, n + 1);
   g_raw[n].price = price;
   g_raw[n].score = weight;
   g_raw[n].mask  = src;
   g_raw[n].swingCount = (src == SRC_SWING) ? 1 : 0;
  }

void CollectPivots()
  {
   // D1 bars come from the broker server, so the day boundary matches live trading
   double h = iHigh(_Symbol, PERIOD_D1, 1);
   double l = iLow(_Symbol, PERIOD_D1, 1);
   double c = iClose(_Symbol, PERIOD_D1, 1);
   if(h <= 0 || l <= 0 || c <= 0)
      return;
   double p = (h + l + c) / 3.0;
   if(InpUsePivot)
     {
      AddRaw(p,             1.0, SRC_PIVOT);
      AddRaw(2.0 * p - l,   1.0, SRC_PIVOT);   // R1
      AddRaw(2.0 * p - h,   1.0, SRC_PIVOT);   // S1
      AddRaw(p + (h - l),   0.8, SRC_PIVOT);   // R2
      AddRaw(p - (h - l),   0.8, SRC_PIVOT);   // S2
     }
   if(InpUsePrevHL)
     {
      AddRaw(h, 1.2, SRC_PREVHL);
      AddRaw(l, 1.2, SRC_PREVHL);
     }
  }

void CollectRound(const double price)
  {
   if(!InpUseRound || InpRoundStep <= 0)
      return;
   double base = MathFloor(price / InpRoundStep) * InpRoundStep;
   for(int i = -InpRoundCount; i <= InpRoundCount + 1; i++)
      AddRaw(base + i * InpRoundStep, 0.8, SRC_ROUND);
  }

void CollectSwings()
  {
   if(!InpUseSwing)
      return;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   int need = InpSwingBars + InpSwingStrength + 2;
   int got = CopyRates(_Symbol, _Period, 0, need, r);
   int s = InpSwingStrength;
   if(got < 2 * s + 3)
      return;
   for(int i = s + 1; i < got - s; i++)
     {
      bool isHigh = true, isLow = true;
      for(int k = 1; k <= s; k++)
        {
         if(r[i].high <= r[i - k].high || r[i].high <= r[i + k].high) isHigh = false;
         if(r[i].low  >= r[i - k].low  || r[i].low  >= r[i + k].low)  isLow  = false;
         if(!isHigh && !isLow) break;
        }
      if(isHigh) AddRaw(r[i].high, 1.0, SRC_SWING);
      if(isLow)  AddRaw(r[i].low,  1.0, SRC_SWING);
     }
  }

int PopCount(int v)
  {
   int c = 0;
   while(v > 0) { c += (v & 1); v >>= 1; }
   return c;
  }

//--- sort raw by price, merge neighbours within tol, keep valid zones
void BuildZones(const double tol)
  {
   ArrayResize(g_zones, 0);
   int n = ArraySize(g_raw);
   if(n == 0)
      return;
   // insertion sort (n is small)
   for(int i = 1; i < n; i++)
     {
      SLevel key = g_raw[i];
      int j = i - 1;
      while(j >= 0 && g_raw[j].price > key.price)
        {
         g_raw[j + 1] = g_raw[j];
         j--;
        }
      g_raw[j + 1] = key;
     }
   int i = 0;
   while(i < n)
     {
      double sumP = g_raw[i].price * g_raw[i].score;
      double sumW = g_raw[i].score;
      int mask = g_raw[i].mask;
      int sw = g_raw[i].swingCount;
      int j = i + 1;
      while(j < n && g_raw[j].price - g_raw[j - 1].price <= tol)
        {
         sumP += g_raw[j].price * g_raw[j].score;
         sumW += g_raw[j].score;
         mask |= g_raw[j].mask;
         sw += g_raw[j].swingCount;
         j++;
        }
      if(sw >= 2)
         mask |= SRC_MULTI;
      if(PopCount(mask) >= InpMinSources)
        {
         int m = ArraySize(g_zones);
         ArrayResize(g_zones, m + 1);
         g_zones[m].price = sumP / sumW;
         g_zones[m].score = sumW;
         g_zones[m].mask = mask;
         g_zones[m].swingCount = sw;
        }
      i = j;
     }
  }

void DrawZones()
  {
   ObjectsDeleteAll(0, g_prefix);
   if(!InpDrawLines)
      return;
   for(int i = 0; i < ArraySize(g_zones); i++)
     {
      string name = g_prefix + IntegerToString(i);
      if(!ObjectCreate(0, name, OBJ_HLINE, 0, 0, g_zones[i].price))
         continue;
      bool strong = (PopCount(g_zones[i].mask) >= 3);
      ObjectSetInteger(0, name, OBJPROP_COLOR, strong ? InpColorStrong : InpColorWeak);
      ObjectSetInteger(0, name, OBJPROP_STYLE, strong ? STYLE_SOLID : STYLE_DOT);
      ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
      ObjectSetInteger(0, name, OBJPROP_BACK, true);
      ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
      string txt = "";
      if((g_zones[i].mask & SRC_PIVOT)  != 0) txt += "P ";
      if((g_zones[i].mask & SRC_PREVHL) != 0) txt += "HL ";
      if((g_zones[i].mask & SRC_ROUND)  != 0) txt += "RN ";
      if((g_zones[i].mask & SRC_SWING)  != 0) txt += "SW ";
      ObjectSetString(0, name, OBJPROP_TEXT, txt);
     }
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| Trading helpers                                                  |
//+------------------------------------------------------------------+
bool HasPosition()
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong t = PositionGetTicket(i);
      if(t == 0) continue;
      if(PositionGetString(POSITION_SYMBOL) == _Symbol &&
         PositionGetInteger(POSITION_MAGIC) == InpMagic)
         return true;
     }
   return false;
  }

bool SafetyOK()
  {
   if(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > InpMaxSpread)
      return false;
   if(TimeCurrent() - g_lastEntry < InpCooldownSec)
      return false;
   if(HasPosition())
      return false;
   return true;
  }

double NextZoneAbove(const double price, const double minGap)
  {
   for(int i = 0; i < ArraySize(g_zones); i++)   // sorted ascending
      if(g_zones[i].price > price + minGap)
         return g_zones[i].price;
   return 0.0;
  }

double NextZoneBelow(const double price, const double minGap)
  {
   for(int i = ArraySize(g_zones) - 1; i >= 0; i--)
      if(g_zones[i].price < price - minGap)
         return g_zones[i].price;
   return 0.0;
  }

void Execute(const bool isBuy, const double zone, const double slPrice, const double atr, const string tag)
  {
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double entry = isBuy ? ask : bid;
   double pt = _Point;
   double minStop = MathMax((double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL),
                            (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL)) * pt;

   double sl = NormalizeDouble(slPrice, _Digits);
   double risk = isBuy ? entry - sl : sl - entry;
   if(risk <= 0 || risk < minStop)
      return;

   double buf = 0.10 * atr;
   double tp = isBuy ? NextZoneAbove(entry, minStop + buf) : NextZoneBelow(entry, minStop + buf);
   if(tp > 0)
      tp = isBuy ? tp - buf : tp + buf;
   else
      tp = isBuy ? entry + InpTPFallbackATR * atr : entry - InpTPFallbackATR * atr;
   tp = NormalizeDouble(tp, _Digits);

   double reward = isBuy ? tp - entry : entry - tp;
   if(reward < minStop || reward < risk * InpMinRR)
      return;

   double lots = InpLots;
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step > 0) lots = MathFloor(lots / step) * step;
   lots = MathMax(vmin, MathMin(vmax, lots));

   bool ok = isBuy ? g_trade.Buy(lots, _Symbol, 0.0, sl, tp, tag)
                   : g_trade.Sell(lots, _Symbol, 0.0, sl, tp, tag);
   if(ok)
      g_lastEntry = TimeCurrent();
   else
      PrintFormat("Order failed: %d %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
  }

//+------------------------------------------------------------------+
//| Signal evaluation on the just-closed bar                         |
//+------------------------------------------------------------------+
void EvaluateSignals(const double atr)
  {
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, 4, r) < 4)
      return;

   double adx[], pdi[], mdi[];
   ArraySetAsSeries(adx, true); ArraySetAsSeries(pdi, true); ArraySetAsSeries(mdi, true);
   if(CopyBuffer(g_adxHandle, 0, 1, 1, adx) < 1 ||
      CopyBuffer(g_adxHandle, 1, 1, 1, pdi) < 1 ||
      CopyBuffer(g_adxHandle, 2, 1, 1, mdi) < 1)
      return;

   double tol = atr * InpZoneATR;
   bool trending = (adx[0] >= InpADXTrend);
   double c1 = r[1].close, o1 = r[1].open, h1 = r[1].high, l1 = r[1].low, c2 = r[2].close;

   for(int i = 0; i < ArraySize(g_zones); i++)
     {
      double p = g_zones[i].price;

      if(!trending && InpTradeBounce)
        {
         // bullish rejection of a zone from above
         if(l1 <= p + tol && l1 >= p - tol && c1 > p && c1 > o1)
           {
            Execute(true, p, MathMin(l1, p - tol) - InpSLBufATR * atr, atr, "PSR bounce");
            return;
           }
         // bearish rejection of a zone from below
         if(h1 >= p - tol && h1 <= p + tol && c1 < p && c1 < o1)
           {
            Execute(false, p, MathMax(h1, p + tol) + InpSLBufATR * atr, atr, "PSR bounce");
            return;
           }
        }

      if(trending && InpTradeBreak)
        {
         double conf = InpBreakConfATR * atr;
         if(c2 <= p && c1 > p + conf && pdi[0] > mdi[0])
           {
            Execute(true, p, p - InpBreakSLATR * atr, atr, "PSR break");
            return;
           }
         if(c2 >= p && c1 < p - conf && mdi[0] > pdi[0])
           {
            Execute(false, p, p + InpBreakSLATR * atr, atr, "PSR break");
            return;
           }
        }
     }
  }

//+------------------------------------------------------------------+
void OnTick()
  {
   datetime bar = iTime(_Symbol, _Period, 0);
   if(bar == g_lastBar)
      return;
   g_lastBar = bar;

   double atrBuf[];
   ArraySetAsSeries(atrBuf, true);
   if(CopyBuffer(g_atrHandle, 0, 1, 1, atrBuf) < 1 || atrBuf[0] <= 0)
      return;
   double atr = atrBuf[0];

   // rebuild levels once per bar
   ArrayResize(g_raw, 0);
   CollectPivots();
   CollectRound(iClose(_Symbol, _Period, 1));
   CollectSwings();
   BuildZones(atr * InpZoneATR);
   DrawZones();

   if(!SafetyOK())
      return;
   EvaluateSignals(atr);
  }
//+------------------------------------------------------------------+
