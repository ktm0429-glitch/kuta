//+------------------------------------------------------------------+
//| kutaGOLD_PivotSR_EA.mq5                                          |
//| Pivot + auto horizontal-line (confluence) EA, M15                |
//| Presets: XAUUSD / USDJPY / EURUSD / BTCUSD (AUTO by symbol name) |
//| Default hours assume TitanFX server time (GMT+2/+3): London = 10:00 |
//| Modules: zone bounce (range) / zone breakout (trend) /           |
//|          session range breakout (Asian range -> London)         |
//+------------------------------------------------------------------+
#property copyright "kuta"
#property version   "0.20"
#property description "Daily pivot + prev H/L + round numbers + swing clusters."
#property description "Zones where >= MinSources overlap are drawn as H-lines and traded."
#property description "Session breakout uses the pre-London range. Hours are SERVER time."

#include <Trade/Trade.mqh>

//--- source bits
#define SRC_PIVOT  1
#define SRC_PREVHL 2
#define SRC_ROUND  4
#define SRC_SWING  8
#define SRC_MULTI  16   // swing zone touched 2+ times

enum ENUM_PRESET
  {
   PRESET_AUTO = 0,    // detect from symbol name
   PRESET_XAUUSD,
   PRESET_USDJPY,
   PRESET_EURUSD,
   PRESET_BTCUSD,
   PRESET_MANUAL       // use the manual values below
  };

//--- inputs
input group "=== General ===";
input ENUM_PRESET InpPreset  = PRESET_AUTO;
input long   InpMagic        = 20251002;
input double InpLots         = 0.10;    // fixed lots (used when InpRiskPct = 0)
input double InpRiskPct      = 0.5;     // risk per trade, % of equity (0 = fixed lots)
input int    InpCooldownSec  = 60;
input int    InpDeviation    = 30;      // points

input group "=== Indicators ===";
input int    InpATRPeriod    = 14;
input int    InpADXPeriod    = 14;

input group "=== Levels ===";
input int    InpRoundCount   = 4;       // round-number steps above/below price
input int    InpSwingBars    = 400;     // M15 bars scanned for swings
input int    InpSwingStrength= 5;       // bars each side for a swing point
input int    InpMinSources   = 2;       // distinct sources needed for a valid zone
input bool   InpUsePivot     = true;
input bool   InpUsePrevHL    = true;
input bool   InpUseRound     = true;
input bool   InpUseSwing     = true;

input group "=== Entry / Exit ===";
input bool   InpTradeBounce  = true;
input bool   InpTradeBreak   = true;
input double InpBreakConfATR = 0.10;    // breakout close must exceed level by ATR*this
input double InpMinRR        = 1.0;     // skip trade if reward/risk below this

input group "=== Session breakout ===";
input double InpRangeMinATR  = 0.5;     // skip day if range narrower than ATR*this
input double InpRangeMaxATR  = 4.0;     // skip day if range wider than ATR*this

input group "=== Manual values (PRESET_MANUAL only) ===";
input double M_RoundStep     = 10.0;
input int    M_MaxSpread     = 50;      // points
input double M_ZoneATR       = 0.30;
input double M_ADXTrend      = 25.0;
input double M_SLBufATR      = 0.50;
input double M_BreakSLATR    = 1.00;
input double M_TPFallbackATR = 2.00;
input double M_MinRisk       = 1.5;     // min SL distance in price units
input bool   M_UseSession    = false;
input int    M_RangeStartHr  = 2;       // server hour
input int    M_RangeEndHr    = 10;
input int    M_TradeEndHr    = 19;
input bool   M_NoWeekend     = false;
input int    M_FridayStopHr  = 21;      // no new entries on Friday after this hour (24 = off)

input group "=== Drawing ===";
input bool   InpDrawLines    = true;
input color  InpColorWeak    = clrDimGray;
input color  InpColorStrong  = clrGold;
input color  InpColorRange   = clrDodgerBlue;

//--- types
struct SLevel
  {
   double price;
   double score;
   int    mask;
   int    swingCount;
  };

struct SPreset
  {
   double roundStep;
   int    maxSpread;
   double zoneATR;
   double adxTrend;
   double slBufATR;
   double breakSLATR;
   double tpFallbackATR;
   double minRisk;
   bool   useSession;
   int    rangeStartHr;
   int    rangeEndHr;
   int    tradeEndHr;
   bool   noWeekend;
   int    fridayStopHr;
  };

//--- globals
CTrade   g_trade;
SPreset  g_p;
string   g_presetName = "";
int      g_atrHandle = INVALID_HANDLE;
int      g_adxHandle = INVALID_HANDLE;
datetime g_lastBar   = 0;
datetime g_lastEntry = 0;
datetime g_sessionDay = 0;     // day on which a session trade was already taken
double   g_rangeHi = 0, g_rangeLo = 0;
bool     g_rangeValid = false;
SLevel   g_raw[];
SLevel   g_zones[];
string   g_prefix    = "kPSR_";

//+------------------------------------------------------------------+
//| Presets                                                          |
//+------------------------------------------------------------------+
void SetPreset(const ENUM_PRESET p)
  {
   switch(p)
     {
      case PRESET_XAUUSD:
         g_presetName = "XAUUSD";
         g_p.roundStep = 10.0;   g_p.maxSpread = 50;   g_p.zoneATR = 0.30; g_p.adxTrend = 25;
         g_p.slBufATR = 0.5;     g_p.breakSLATR = 1.0; g_p.tpFallbackATR = 2.0; g_p.minRisk = 1.5;
         g_p.useSession = false; g_p.rangeStartHr = 2; g_p.rangeEndHr = 10; g_p.tradeEndHr = 19;
         g_p.noWeekend = false;  g_p.fridayStopHr = 21;
         break;
      case PRESET_USDJPY:
         g_presetName = "USDJPY";
         g_p.roundStep = 1.0;    g_p.maxSpread = 30;   g_p.zoneATR = 0.30; g_p.adxTrend = 25;
         g_p.slBufATR = 0.5;     g_p.breakSLATR = 1.0; g_p.tpFallbackATR = 2.0; g_p.minRisk = 0.15;
         g_p.useSession = true;  g_p.rangeStartHr = 2; g_p.rangeEndHr = 10; g_p.tradeEndHr = 19;
         g_p.noWeekend = false;  g_p.fridayStopHr = 20;
         break;
      case PRESET_EURUSD:
         g_presetName = "EURUSD";
         g_p.roundStep = 0.0050; g_p.maxSpread = 30;   g_p.zoneATR = 0.30; g_p.adxTrend = 25;
         g_p.slBufATR = 0.5;     g_p.breakSLATR = 1.0; g_p.tpFallbackATR = 2.0; g_p.minRisk = 0.0012;
         g_p.useSession = true;  g_p.rangeStartHr = 2; g_p.rangeEndHr = 10; g_p.tradeEndHr = 19;
         g_p.noWeekend = false;  g_p.fridayStopHr = 20;
         break;
      case PRESET_BTCUSD:
         g_presetName = "BTCUSD";
         g_p.roundStep = 1000.0; g_p.maxSpread = 6000; g_p.zoneATR = 0.30; g_p.adxTrend = 25;
         g_p.slBufATR = 0.5;     g_p.breakSLATR = 1.5; g_p.tpFallbackATR = 2.5; g_p.minRisk = 150.0;
         g_p.useSession = false; g_p.rangeStartHr = 2; g_p.rangeEndHr = 10; g_p.tradeEndHr = 19;
         g_p.noWeekend = true;   g_p.fridayStopHr = 24;
         break;
      default:
         g_presetName = "MANUAL";
         g_p.roundStep = M_RoundStep;   g_p.maxSpread = M_MaxSpread;   g_p.zoneATR = M_ZoneATR;
         g_p.adxTrend = M_ADXTrend;     g_p.slBufATR = M_SLBufATR;     g_p.breakSLATR = M_BreakSLATR;
         g_p.tpFallbackATR = M_TPFallbackATR; g_p.minRisk = M_MinRisk;
         g_p.useSession = M_UseSession; g_p.rangeStartHr = M_RangeStartHr;
         g_p.rangeEndHr = M_RangeEndHr; g_p.tradeEndHr = M_TradeEndHr;
         g_p.noWeekend = M_NoWeekend;   g_p.fridayStopHr = M_FridayStopHr;
         break;
     }
  }

ENUM_PRESET DetectPreset()
  {
   string s = _Symbol;
   StringToUpper(s);
   if(StringFind(s, "XAU") >= 0)    return PRESET_XAUUSD;
   if(StringFind(s, "USDJPY") >= 0) return PRESET_USDJPY;
   if(StringFind(s, "EURUSD") >= 0) return PRESET_EURUSD;
   if(StringFind(s, "BTC") >= 0)    return PRESET_BTCUSD;
   return PRESET_MANUAL;
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   ENUM_PRESET p = (InpPreset == PRESET_AUTO) ? DetectPreset() : InpPreset;
   SetPreset(p);
   if(InpPreset == PRESET_AUTO && p == PRESET_MANUAL)
      Print("Symbol not recognised for AUTO preset; using MANUAL values.");
   PrintFormat("Preset: %s (roundStep=%g maxSpread=%d minRisk=%g session=%s)",
               g_presetName, g_p.roundStep, g_p.maxSpread, g_p.minRisk,
               g_p.useSession ? "on" : "off");

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
   if(!InpUseRound || g_p.roundStep <= 0)
      return;
   double base = MathFloor(price / g_p.roundStep) * g_p.roundStep;
   for(int i = -InpRoundCount; i <= InpRoundCount + 1; i++)
      AddRaw(base + i * g_p.roundStep, 0.8, SRC_ROUND);
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

//+------------------------------------------------------------------+
//| Drawing                                                          |
//+------------------------------------------------------------------+
void DrawLine(const string name, const double price, const color clr,
              const ENUM_LINE_STYLE style, const string txt)
  {
   if(!ObjectCreate(0, name, OBJ_HLINE, 0, 0, price))
      return;
   ObjectSetInteger(0, name, OBJPROP_COLOR, clr);
   ObjectSetInteger(0, name, OBJPROP_STYLE, style);
   ObjectSetInteger(0, name, OBJPROP_WIDTH, 1);
   ObjectSetInteger(0, name, OBJPROP_BACK, true);
   ObjectSetInteger(0, name, OBJPROP_SELECTABLE, false);
   ObjectSetString(0, name, OBJPROP_TEXT, txt);
  }

void DrawAll()
  {
   ObjectsDeleteAll(0, g_prefix);
   if(!InpDrawLines)
      return;
   for(int i = 0; i < ArraySize(g_zones); i++)
     {
      bool strong = (PopCount(g_zones[i].mask) >= 3);
      string txt = "";
      if((g_zones[i].mask & SRC_PIVOT)  != 0) txt += "P ";
      if((g_zones[i].mask & SRC_PREVHL) != 0) txt += "HL ";
      if((g_zones[i].mask & SRC_ROUND)  != 0) txt += "RN ";
      if((g_zones[i].mask & SRC_SWING)  != 0) txt += "SW ";
      DrawLine(g_prefix + IntegerToString(i), g_zones[i].price,
               strong ? InpColorStrong : InpColorWeak,
               strong ? STYLE_SOLID : STYLE_DOT, txt);
     }
   if(g_p.useSession && g_rangeValid)
     {
      DrawLine(g_prefix + "RangeHi", g_rangeHi, InpColorRange, STYLE_DASH, "Range Hi");
      DrawLine(g_prefix + "RangeLo", g_rangeLo, InpColorRange, STYLE_DASH, "Range Lo");
     }
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| Safety / time filters                                            |
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

bool TimeAllowed()
  {
   MqlDateTime t;
   TimeToStruct(TimeCurrent(), t);
   if(g_p.noWeekend && (t.day_of_week == 0 || t.day_of_week == 6))
      return false;
   if(t.day_of_week == 5 && t.hour >= g_p.fridayStopHr)
      return false;
   return true;
  }

bool SafetyOK()
  {
   if(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > g_p.maxSpread)
      return false;
   if(TimeCurrent() - g_lastEntry < InpCooldownSec)
      return false;
   if(!TimeAllowed())
      return false;
   if(HasPosition())
      return false;
   return true;
  }

//+------------------------------------------------------------------+
//| Order helpers                                                    |
//+------------------------------------------------------------------+
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

double CalcLots(const double riskPrice)
  {
   double lots = InpLots;
   double tickV = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickS = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(InpRiskPct > 0 && tickV > 0 && tickS > 0 && riskPrice > 0)
     {
      double money = AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPct / 100.0;
      double perLot = riskPrice / tickS * tickV;
      if(perLot > 0)
         lots = money / perLot;
     }
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step > 0) lots = MathFloor(lots / step) * step;
   return MathMax(vmin, MathMin(vmax, lots));
  }

bool Execute(const bool isBuy, const double slPrice, const double atr, const string tag)
  {
   double entry = SymbolInfoDouble(_Symbol, isBuy ? SYMBOL_ASK : SYMBOL_BID);
   double minStop = MathMax((double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL),
                            (double)SymbolInfoInteger(_Symbol, SYMBOL_TRADE_FREEZE_LEVEL)) * _Point;

   // enforce minimum SL distance (price units, per preset)
   double risk = isBuy ? entry - slPrice : slPrice - entry;
   double floorRisk = MathMax(g_p.minRisk, minStop);
   if(risk < floorRisk)
      risk = floorRisk;
   double sl = NormalizeDouble(isBuy ? entry - risk : entry + risk, _Digits);

   double buf = 0.10 * atr;
   double tp = isBuy ? NextZoneAbove(entry, minStop + buf) : NextZoneBelow(entry, minStop + buf);
   if(tp > 0)
      tp = isBuy ? tp - buf : tp + buf;
   else
      tp = isBuy ? entry + g_p.tpFallbackATR * atr : entry - g_p.tpFallbackATR * atr;
   tp = NormalizeDouble(tp, _Digits);

   double reward = isBuy ? tp - entry : entry - tp;
   if(reward < minStop || reward < risk * InpMinRR)
      return false;

   double lots = CalcLots(risk);
   bool ok = isBuy ? g_trade.Buy(lots, _Symbol, 0.0, sl, tp, tag)
                   : g_trade.Sell(lots, _Symbol, 0.0, sl, tp, tag);
   if(ok)
      g_lastEntry = TimeCurrent();
   else
      PrintFormat("Order failed: %d %s", g_trade.ResultRetcode(), g_trade.ResultRetcodeDescription());
   return ok;
  }

//+------------------------------------------------------------------+
//| Session range breakout                                           |
//+------------------------------------------------------------------+
//--- compute today's pre-session range from closed M15 bars (server time)
void UpdateSessionRange()
  {
   g_rangeValid = false;
   if(!g_p.useSession || g_p.rangeStartHr >= g_p.rangeEndHr)
      return;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, _Period, 0, 200, r) < 10)
      return;
   datetime today = r[0].time - (r[0].time % 86400);
   double hi = 0, lo = 0;
   int cnt = 0;
   for(int i = 1; i < ArraySize(r); i++)
     {
      if(r[i].time < today)
         break;
      MqlDateTime t;
      TimeToStruct(r[i].time, t);
      if(t.hour < g_p.rangeStartHr || t.hour >= g_p.rangeEndHr)
         continue;
      if(cnt == 0 || r[i].high > hi) hi = r[i].high;
      if(cnt == 0 || r[i].low  < lo) lo = r[i].low;
      cnt++;
     }
   if(cnt < 4)
      return;
   g_rangeHi = hi;
   g_rangeLo = lo;
   g_rangeValid = true;
  }

bool EvaluateSession(const double atr, const MqlRates &r[], const double pdi, const double mdi)
  {
   if(!g_p.useSession || !g_rangeValid)
      return false;
   MqlDateTime now;
   TimeToStruct(TimeCurrent(), now);
   if(now.hour < g_p.rangeEndHr || now.hour >= g_p.tradeEndHr)
      return false;
   datetime today = TimeCurrent() - (TimeCurrent() % 86400);
   if(g_sessionDay == today)
      return false;
   double width = g_rangeHi - g_rangeLo;
   if(width < InpRangeMinATR * atr || width > InpRangeMaxATR * atr)
      return false;

   double conf = InpBreakConfATR * atr;
   double c1 = r[1].close, c2 = r[2].close;
   if(c2 <= g_rangeHi && c1 > g_rangeHi + conf && pdi > mdi)
     {
      if(Execute(true, g_rangeHi - g_p.breakSLATR * atr, atr, "PSR session"))
         g_sessionDay = today;
      return true;
     }
   if(c2 >= g_rangeLo && c1 < g_rangeLo - conf && mdi > pdi)
     {
      if(Execute(false, g_rangeLo + g_p.breakSLATR * atr, atr, "PSR session"))
         g_sessionDay = today;
      return true;
     }
   return false;
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

   if(EvaluateSession(atr, r, pdi[0], mdi[0]))
      return;

   double tol = atr * g_p.zoneATR;
   bool trending = (adx[0] >= g_p.adxTrend);
   double c1 = r[1].close, o1 = r[1].open, h1 = r[1].high, l1 = r[1].low, c2 = r[2].close;

   for(int i = 0; i < ArraySize(g_zones); i++)
     {
      double p = g_zones[i].price;

      if(!trending && InpTradeBounce)
        {
         // bullish rejection of a zone from above
         if(l1 <= p + tol && l1 >= p - tol && c1 > p && c1 > o1)
           {
            Execute(true, MathMin(l1, p - tol) - g_p.slBufATR * atr, atr, "PSR bounce");
            return;
           }
         // bearish rejection of a zone from below
         if(h1 >= p - tol && h1 <= p + tol && c1 < p && c1 < o1)
           {
            Execute(false, MathMax(h1, p + tol) + g_p.slBufATR * atr, atr, "PSR bounce");
            return;
           }
        }

      if(trending && InpTradeBreak)
        {
         double conf = InpBreakConfATR * atr;
         if(c2 <= p && c1 > p + conf && pdi[0] > mdi[0])
           {
            Execute(true, p - g_p.breakSLATR * atr, atr, "PSR break");
            return;
           }
         if(c2 >= p && c1 < p - conf && mdi[0] > pdi[0])
           {
            Execute(false, p + g_p.breakSLATR * atr, atr, "PSR break");
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
   BuildZones(atr * g_p.zoneATR);
   UpdateSessionRange();
   DrawAll();

   if(!SafetyOK())
      return;
   EvaluateSignals(atr);
  }
//+------------------------------------------------------------------+
