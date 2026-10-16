//+------------------------------------------------------------------+
//| kutaGOLD_SMC_Macro.mq5                                           |
//| EA name : kutaGOLD 4.2 SMC Macro                                 |
//|                                                                  |
//| Internal engine : GOLD SMC EA spec Ver.1.1  (sections 2.1-2.6)   |
//|    H4 BoS -> Order Block -> Retest (2.4 baseline) -> Kicker      |
//| External filter: US 10Y yield + US Dollar Index (DXY)            |
//|    Gold is inversely related to both. Their momentum is combined |
//|    into a single "gold macro bias" that adjusts the SMC score    |
//|    (or filters trades), it never creates entries by itself.      |
//|                                                                  |
//| Single file, no external dependencies (spec section 0).          |
//| NOT compiled / back-tested by the author of this file.           |
//| Compile in MetaEditor, then run Every tick based on real ticks.  |
//+------------------------------------------------------------------+
#property copyright "kutaGOLD"
#property version   "4.20"
#property description "kutaGOLD 4.2 SMC Macro : SMC structure (BoS/OB/Retest/Kicker) + US10Y/DXY macro filter"
#property strict

#include <Trade/Trade.mqh>

CTrade trade;

//+------------------------------------------------------------------+
//| Inputs                                                           |
//+------------------------------------------------------------------+
enum ENUM_MACRO_MODE
{
   MACRO_OFF    = 0,   // Off (internal SMC only)
   MACRO_SCORE  = 1,   // Score: aligned = bonus, against = penalty
   MACRO_FILTER = 2,   // Filter: block trades against macro bias
   MACRO_STRICT = 3    // Strict: only trade when macro is aligned
};

input group "=== General ==="
input string EA_Name           = "kutaGOLD 4.2 SMC Macro";
input int    MagicNumber       = 4200001;   // version 42 / env 00 / mode 01
input int    DeviationPts      = 50;
input int    MaxSpreadPts      = 100;       // spec 6: skip entries above this
input int    MaxPositions      = 1;
input double MaxLots           = 50.0;

input group "=== Timeframes ==="
input ENUM_TIMEFRAMES TF_Direction = PERIOD_D1;   // direction check
input ENUM_TIMEFRAMES TF_Structure = PERIOD_H4;   // BoS / OB
input ENUM_TIMEFRAMES TF_Execution = PERIOD_H1;   // retest / entry

input group "=== Structure (spec 2.1) ==="
input int    ATR_Period        = 14;
input int    Swing_Len_H4      = 20;     // bars each side
input int    Swing_Len_D1      = 5;
input int    Swing_ScanBars    = 300;
input int    Trend_Rises       = 2;      // consecutive HH+HL / LH+LL (spec: 2)
input double BoS_ATRMult       = 0.1;    // close must clear swing by ATR x this
input int    BoS_ConfirmBars   = 2;      // consecutive closes beyond swing
input int    BoS_MaxRunBars    = 3;      // ignore stale breaks older than this
input double BoS_InvalidATR    = 1.0;    // BoS BROKEN when close is this far back through level
input int    BoS_MaxAgeBars    = 100;    // structure bars

input group "=== Order Block (spec 2.2) ==="
input int    OB_ScanBars       = 5;      // look back from the break candle
input int    OB_FreshBars      = 50;
input int    OB_MaxAgeBars     = 100;
input int    OB_MaxTests       = 3;

input group "=== Kicker (spec 2.3) ==="
input double Kicker_GapATR     = 0.5;
input double Kicker_WickFrac   = 0.15;   // max opposite wick / body
input int    Kicker_Bonus      = 10;

input group "=== Retest (spec 2.4 = internal baseline) ==="
input double Retest_Tier1      = 0.10;   // high precision : immediate entry
input double Retest_Tier2      = 0.25;   // standard       : kicker recommended
input double Retest_Tier3      = 0.50;   // mid            : session core + ATR expansion required
input double Retest_Tier4      = 0.75;   // low            : disabled unless allowed
input bool   Retest_AllowTier4 = false;
input int    Retest_MinGapBars = 10;     // min bars between two tests (2nd test rule)
input int    Retest_WindowBars = 3;      // entry allowed this many bars after the touch
input bool   Retest_AllowThird = false;  // 3rd test: normally skipped
input double Conf_Test1        = 1.00;
input double Conf_Test2        = 0.70;
input double Conf_Test3        = 0.40;
input int    NoKickerPenalty   = 10;     // tier-2 touch without kicker

input group "=== Score / Risk (spec 2.3) ==="
input int    Score_BoS         = 50;
input int    Score_OB_Fresh    = 30;
input int    Score_OB_Old      = 15;
input int    Score_Retest      = 20;
input int    Score_Min         = 50;
input double Risk_Score80      = 2.0;    // %
input double Risk_Score60      = 1.5;
input double Risk_Score50      = 1.0;

input group "=== Exit (spec 2.6) ==="
input double SL_ATR            = 1.5;
input double TP1_ATR           = 1.5;
input double TP2_ATR           = 3.0;
input double TP3_ATR           = 5.0;
input double TP_ClosePct       = 30.0;   // each of TP1..TP3
input double Trail_ATR         = 1.0;
input double Trail_Tighten     = 0.5;    // multiplier after D1 reversal
input int    BE_BufferPts      = 10;
input double OB_BreakATR       = 0.1;
input int    MaxHoldHours      = 120;    // 0 = off

input group "=== Session / Time (spec 6, GMT based, DST auto) ==="
input int    Srv_GMTOffset_Winter = 2;   // broker server GMT offset in winter (TAITAN: +2)
input bool   Srv_FollowsUSDST     = true;// server shifts +1h during US DST (TAITAN: yes)
input double Sess_Start_Winter    = 8.0; // London open, GMT (shifted -1h in UK DST)
input double Sess_End_Winter      = 17.0;// NY 12:00, GMT   (shifted -1h in US DST)
input double Core_Start_Winter    = 13.0;// London/NY overlap start (shifted by US DST)
input double Core_End_Winter      = 16.0;
input int    Boundary_Min         = 15;  // no new entries this close to session edges
input int    SessionEnd_Action    = 1;   // 0 none, 1 reduce 50%, 2 close all (Asia crossing)
input bool   FridayFlat           = true;// close all at NY Friday 12:00
input string News_GMT_List        = "";  // "2026.11.06 13:30;2026.12.18 19:00"
input int    News_WindowMin       = 30;

input group "=== Safety ==="
input int    Gap_WaitBars      = 1;      // wait after weekend gap > ATR x 3
input double Gap_ATRMult       = 3.0;
input double Spike_Mult        = 3.0;    // skip entries when ATR > avg x this
input bool   Use_D1_Bias       = false;  // block entries against last D1 BoS

input group "=== EXTERNAL: US10Y + DXY macro filter ==="
input ENUM_MACRO_MODE Macro_Mode = MACRO_SCORE;
input ENUM_TIMEFRAMES TF_Macro   = PERIOD_D1;
input string DXY_Symbol          = "";    // "" = auto-detect (see candidates in code)
input bool   DXY_UseSynthetic    = true;  // build DXY from 6 FX pairs if no index symbol
input string DXY_PairSuffix      = "";    // broker suffix for synthetic pairs, e.g. ".a"
input string US10Y_Symbol        = "";    // "" = auto-detect
input bool   US10Y_IsPrice       = false; // true if the symbol is a T-Note PRICE (inverse of yield)
input int    Macro_Lookback      = 10;    // momentum window (macro TF bars)
input int    Macro_VolWindow     = 60;    // volatility window for normalisation
input double Macro_W_DXY         = 1.0;
input double Macro_W_Yield       = 1.0;
input double Macro_Threshold     = 0.5;   // |bias| needed to count as aligned/against
input double Macro_StrongThr     = 1.5;   // strong conflict level
input bool   Macro_BlockStrong   = true;  // hard-block entries against a strong macro bias
input int    Macro_Bonus         = 15;    // score when aligned
input int    Macro_Penalty       = 25;    // score when against
input bool   Macro_BlockIfMissing= false; // block entries when no macro data is available

//+------------------------------------------------------------------+
//| Types / globals                                                  |
//+------------------------------------------------------------------+
#define MAX_BOS 50
#define MAX_OB  100

enum ENUM_STATE { ST_ACTIVE, ST_EXPIRED, ST_TESTED, ST_BROKEN };

struct SSwing
{
   double   price;
   datetime time;
   int      shift;
};

struct SBoS
{
   string     id;
   datetime   time;
   datetime   swingTime;
   double     level;
   bool       bullish;
   ENUM_STATE state;
   double     atr;
   int        score;
   int        testCount;
   datetime   lastTest;
   double     tierP;
   bool       entered;
};

struct SOB
{
   string     id;
   datetime   time;
   double     high;
   double     low;
   bool       bullish;
   ENUM_STATE state;
   int        testCount;
   string     parentBoS;
};

struct SMacro
{
   bool     valid;
   bool     okD;
   bool     okY;
   bool     synth;
   double   zD;
   double   zY;
   double   g;        // gold impulse: positive = macro supports gold
   int      bias;     // +1 / 0 / -1
   bool     strong;
   datetime stamp;
};

struct SPending
{
   bool   valid;
   double atr;
   double obx;
   int    score;
};

SBoS     g_bos[MAX_BOS];
SOB      g_ob[MAX_OB];
int      g_bosN = 0;
int      g_obN  = 0;
int      g_idSeq = 0;

int      h_atrExec   = INVALID_HANDLE;
int      h_atrStruct = INVALID_HANDLE;
int      h_atrDir    = INVALID_HANDLE;

datetime g_lastDirBar    = 0;
datetime g_lastStructBar = 0;
datetime g_lastExecBar   = 0;

int      g_trend = 0;               // H4 swing trend: +1 / -1 / 0
int      g_d1Dir = 0;
datetime g_d1SwingTime = 0;

double   g_atrExec = 0.0;
bool     g_atrExpanding = false;
bool     g_atrSpike = false;
datetime g_gapWaitUntil = 0;

datetime g_news[];

string   g_dxySym  = "";
bool     g_dxySynth = false;
string   g_y10Sym  = "";
SMacro   g_mac;
SPending g_pend;
bool     g_macroWarned = false;

//+------------------------------------------------------------------+
//| Small helpers                                                    |
//+------------------------------------------------------------------+
double GetATR(const int handle, const int shift)
{
   if(handle == INVALID_HANDLE) return 0.0;
   double buf[1];
   if(CopyBuffer(handle, 0, shift, 1, buf) != 1) return 0.0;
   return buf[0];
}

int VolDigits()
{
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(step <= 0.0) return 2;
   int d = (int)MathRound(-MathLog10(step));
   if(d < 0) d = 0;
   if(d > 8) d = 8;
   return d;
}

double NormVol(double v)
{
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double mn   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double mx   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0.0) step = 0.01;
   v = MathFloor(v / step + 1e-8) * step;
   if(v < mn - 1e-12) return 0.0;
   if(v > mx) v = mx;
   return NormalizeDouble(v, VolDigits());
}

string GVN(const ulong tk, const string key)
{
   return "kGSM" + IntegerToString(MagicNumber) + "_" + IntegerToString((long)tk) + "_" + key;
}

double GVD(const ulong tk, const string key, const double def = 0.0)
{
   string n = GVN(tk, key);
   if(GlobalVariableCheck(n)) return GlobalVariableGet(n);
   return def;
}

void GVS(const ulong tk, const string key, const double v)
{
   GlobalVariableSet(GVN(tk, key), v);
}

//+------------------------------------------------------------------+
//| GMT / DST handling                                               |
//+------------------------------------------------------------------+
int DaysInMonth(const int y, const int m)
{
   static int d[12] = {31,28,31,30,31,30,31,31,30,31,30,31};
   if(m == 2 && ((y % 4 == 0 && y % 100 != 0) || y % 400 == 0)) return 29;
   return d[m - 1];
}

int DayOfWeekOf(const int y, const int m, const int dd)
{
   MqlDateTime s;
   s.year = y; s.mon = m; s.day = dd; s.hour = 0; s.min = 0; s.sec = 0;
   datetime t = StructToTime(s);
   TimeToStruct(t, s);
   return s.day_of_week;
}

// n >= 1 : n-th Sunday of the month, n == -1 : last Sunday
int NthSunday(const int y, const int m, const int n)
{
   if(n > 0)
   {
      int dow1 = DayOfWeekOf(y, m, 1);
      return 1 + ((7 - dow1) % 7) + (n - 1) * 7;
   }
   int last = DaysInMonth(y, m);
   int dowl = DayOfWeekOf(y, m, last);
   return last - dowl;
}

bool IsUSDST(const datetime t)
{
   MqlDateTime s;
   TimeToStruct(t, s);
   int ymd = s.year * 10000 + s.mon * 100 + s.day;
   int st  = s.year * 10000 + 300  + NthSunday(s.year, 3, 2);
   int en  = s.year * 10000 + 1100 + NthSunday(s.year, 11, 1);
   return (ymd >= st && ymd < en);
}

bool IsUKDST(const datetime t)
{
   MqlDateTime s;
   TimeToStruct(t, s);
   int ymd = s.year * 10000 + s.mon * 100 + s.day;
   int st  = s.year * 10000 + 300  + NthSunday(s.year, 3, -1);
   int en  = s.year * 10000 + 1000 + NthSunday(s.year, 10, -1);
   return (ymd >= st && ymd < en);
}

datetime ServerToGMT(const datetime serverTime)
{
   int off = Srv_GMTOffset_Winter;
   if(Srv_FollowsUSDST && IsUSDST(serverTime)) off++;
   return serverTime - off * 3600;
}

double GMTHour(const datetime gmt)
{
   MqlDateTime s;
   TimeToStruct(gmt, s);
   return s.hour + s.min / 60.0;
}

int GMTDow(const datetime gmt)
{
   MqlDateTime s;
   TimeToStruct(gmt, s);
   return s.day_of_week;
}

void SessionTimes(const datetime gmt, double &ss, double &se, double &cs, double &ce)
{
   double uk = IsUKDST(gmt) ? 1.0 : 0.0;
   double us = IsUSDST(gmt) ? 1.0 : 0.0;
   ss = Sess_Start_Winter - uk;
   se = Sess_End_Winter   - us;
   cs = Core_Start_Winter - us;
   ce = Core_End_Winter   - us;
}

bool InRange(const double h, const double a, const double b)
{
   if(a <= b) return (h >= a && h < b);
   return (h >= a || h < b);
}

void ParseNews()
{
   ArrayResize(g_news, 0);
   if(StringLen(News_GMT_List) < 10) return;
   string parts[];
   int n = StringSplit(News_GMT_List, ';', parts);
   for(int i = 0; i < n; i++)
   {
      string s = parts[i];
      StringTrimLeft(s);
      StringTrimRight(s);
      if(StringLen(s) < 10) continue;
      datetime t = StringToTime(s);
      if(t <= 0) continue;
      int k = ArraySize(g_news);
      ArrayResize(g_news, k + 1);
      g_news[k] = t;
   }
}

bool InNewsBlackout(const datetime gmt)
{
   for(int i = 0; i < ArraySize(g_news); i++)
      if(MathAbs((double)(gmt - g_news[i])) <= News_WindowMin * 60.0) return true;
   return false;
}

//+------------------------------------------------------------------+
//| Position helpers                                                 |
//+------------------------------------------------------------------+
bool IsMyPosition()
{
   if(PositionGetString(POSITION_SYMBOL) != _Symbol) return false;
   if(PositionGetInteger(POSITION_MAGIC) != MagicNumber) return false;
   return true;
}

int CountPositions()
{
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(!PositionSelectByTicket(tk)) continue;
      if(IsMyPosition()) c++;
   }
   return c;
}

bool ClosePos(const ulong tk, const string why)
{
   if(!trade.PositionClose(tk))
   {
      PrintFormat("[%s] close #%I64u failed (%s): %d %s", EA_Name, tk, why, trade.ResultRetcode(), trade.ResultRetcodeDescription());
      return false;
   }
   PrintFormat("[%s] close #%I64u (%s)", EA_Name, tk, why);
   return true;
}

// close 'frac' (0..1) of the CURRENT volume of the selected position
bool ClosePartialFrac(const ulong tk, const double frac, const string why)
{
   double cur = 0.0;
   if(!PositionGetDouble(POSITION_VOLUME, cur)) return false;
   double mn  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vol = NormVol(cur * frac);
   if(vol <= 0.0) return false;
   if(cur - vol < mn - 1e-12) return false;   // would leave less than min lot
   if(!trade.PositionClosePartial(tk, vol))
   {
      PrintFormat("[%s] partial #%I64u failed (%s): %d %s", EA_Name, tk, why, trade.ResultRetcode(), trade.ResultRetcodeDescription());
      return false;
   }
   PrintFormat("[%s] partial #%I64u %.2f lots (%s)", EA_Name, tk, vol, why);
   return true;
}

// close 'vol' lots of the selected position
bool ClosePartialVol(const ulong tk, const double want, const string why)
{
   double cur = 0.0;
   if(!PositionGetDouble(POSITION_VOLUME, cur)) return false;
   double mn  = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vol = NormVol(want);
   if(vol <= 0.0) return false;
   if(vol >= cur) return false;
   if(cur - vol < mn - 1e-12) return false;
   if(!trade.PositionClosePartial(tk, vol))
   {
      PrintFormat("[%s] partial #%I64u failed (%s): %d %s", EA_Name, tk, why, trade.ResultRetcode(), trade.ResultRetcodeDescription());
      return false;
   }
   PrintFormat("[%s] partial #%I64u %.2f lots (%s)", EA_Name, tk, vol, why);
   return true;
}

// Create per-position state the first time a position is seen (also after EA restart).
void EnsureState(const ulong tk)
{
   if(GlobalVariableCheck(GVN(tk, "atr"))) return;
   double open = 0.0, sl = 0.0, vol = 0.0;
   PositionGetDouble(POSITION_PRICE_OPEN, open);
   PositionGetDouble(POSITION_SL, sl);
   PositionGetDouble(POSITION_VOLUME, vol);
   double atrE = g_atrExec;
   double obx  = 0.0;
   if(g_pend.valid)
   {
      atrE = g_pend.atr;
      obx  = g_pend.obx;
      g_pend.valid = false;
   }
   else if(sl > 0.0 && SL_ATR > 0.0)
      atrE = MathAbs(open - sl) / SL_ATR;
   GVS(tk, "atr", atrE);
   GVS(tk, "vol", vol);
   GVS(tk, "obx", obx);
   GVS(tk, "stage", 0);
   GVS(tk, "flags", 0);
}

void CleanupState()
{
   string prefix = "kGSM" + IntegerToString(MagicNumber) + "_";
   for(int i = GlobalVariablesTotal() - 1; i >= 0; i--)
   {
      string n = GlobalVariableName(i);
      if(StringFind(n, prefix) != 0) continue;
      string rest = StringSubstr(n, StringLen(prefix));
      int p = StringFind(rest, "_");
      if(p <= 0) continue;
      ulong tk = (ulong)StringToInteger(StringSubstr(rest, 0, p));
      if(!PositionSelectByTicket(tk)) GlobalVariableDel(n);
   }
}

// close every position of this EA that goes opposite to 'dir' (reverse BoS, spec 2.6 priority 1)
void CloseOpposite(const int dir)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(!PositionSelectByTicket(tk)) continue;
      if(!IsMyPosition()) continue;
      long type = PositionGetInteger(POSITION_TYPE);
      bool isBuy = (type == POSITION_TYPE_BUY);
      if((dir > 0 && !isBuy) || (dir < 0 && isBuy)) ClosePos(tk, "reverse BoS H4");
   }
}

// D1 reverse BoS: 75% close + tighten trail (spec 2.6)
void ApplyD1Reverse(const int dir)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(!PositionSelectByTicket(tk)) continue;
      if(!IsMyPosition()) continue;
      EnsureState(tk);
      long type = PositionGetInteger(POSITION_TYPE);
      bool isBuy = (type == POSITION_TYPE_BUY);
      if(!((dir > 0 && !isBuy) || (dir < 0 && isBuy))) continue;
      int f = (int)GVD(tk, "flags", 0);
      if((f & 2) != 0) continue;
      ClosePartialFrac(tk, 0.75, "reverse BoS D1");
      f |= 2;
      f |= 8;
      GVS(tk, "flags", f);
   }
}

//+------------------------------------------------------------------+
//| Structure engine : swings, trend, BoS, OB                        |
//+------------------------------------------------------------------+
int CollectSwings(const ENUM_TIMEFRAMES tf, const int len, const int scan, const bool wantHigh, const int need, SSwing &out[])
{
   ArrayResize(out, 0);
   int total = scan + 2 * len + 2;
   MqlRates r[];
   ArraySetAsSeries(r, true);
   int got = CopyRates(_Symbol, tf, 0, total, r);
   if(got < total) return 0;
   int cnt = 0;
   for(int i = len + 1; i <= scan + len + 1 && cnt < need; i++)
   {
      bool ok = true;
      for(int j = 1; j <= len && ok; j++)
      {
         if(wantHigh)
         {
            if(!(r[i].high > r[i - j].high && r[i].high > r[i + j].high)) ok = false;
         }
         else
         {
            if(!(r[i].low < r[i - j].low && r[i].low < r[i + j].low)) ok = false;
         }
      }
      if(!ok) continue;
      ArrayResize(out, cnt + 1);
      out[cnt].price = wantHigh ? r[i].high : r[i].low;
      out[cnt].time  = r[i].time;
      out[cnt].shift = i;
      cnt++;
   }
   return cnt;
}

// +1 : 'rises' consecutive higher-high AND higher-low, -1 : the opposite, 0 : range
int TrendFromSwings(SSwing &hi[], SSwing &lo[], const int rises)
{
   if(rises < 1) return 0;
   if(ArraySize(hi) < rises + 1 || ArraySize(lo) < rises + 1) return 0;
   bool up = true, dn = true;
   for(int k = 0; k < rises; k++)
   {
      if(!(hi[k].price > hi[k + 1].price && lo[k].price > lo[k + 1].price)) up = false;
      if(!(hi[k].price < hi[k + 1].price && lo[k].price < lo[k + 1].price)) dn = false;
   }
   if(up) return 1;
   if(dn) return -1;
   return 0;
}

// Fresh confirmed BoS against the newest swing (equal values are not a break).
bool DetectBoS(const ENUM_TIMEFRAMES tf, const int atrHandle, SSwing &hi[], SSwing &lo[],
               int &dir, double &level, datetime &swingTime, int &run)
{
   dir = 0; run = 0;
   double atr = GetATR(atrHandle, 1);
   if(atr <= 0.0) return false;
   double thr = atr * BoS_ATRMult;

   if(ArraySize(hi) > 0)
   {
      int r = 0;
      for(int s = 1; s <= BoS_MaxRunBars + 1; s++)
      {
         double c = iClose(_Symbol, tf, s);
         if(c > hi[0].price + thr) r++; else break;
      }
      if(r >= BoS_ConfirmBars && r <= BoS_MaxRunBars)
      {
         dir = 1; level = hi[0].price; swingTime = hi[0].time; run = r;
         return true;
      }
   }
   if(ArraySize(lo) > 0)
   {
      int r = 0;
      for(int s = 1; s <= BoS_MaxRunBars + 1; s++)
      {
         double c = iClose(_Symbol, tf, s);
         if(c > 0.0 && c < lo[0].price - thr) r++; else break;
      }
      if(r >= BoS_ConfirmBars && r <= BoS_MaxRunBars)
      {
         dir = -1; level = lo[0].price; swingTime = lo[0].time; run = r;
         return true;
      }
   }
   return false;
}

bool RegisterBoS(const int dir, const double level, const datetime swingTime, const int run)
{
   bool bull = (dir > 0);
   for(int i = 0; i < g_bosN; i++)
      if(g_bos[i].swingTime == swingTime && g_bos[i].bullish == bull) return false;

   // newest structure wins : older BoS / OB are retired (spec 2.2 multiple-OB rule)
   for(int i = 0; i < g_bosN; i++)
      if(g_bos[i].state == ST_ACTIVE || g_bos[i].state == ST_TESTED) g_bos[i].state = ST_EXPIRED;
   for(int i = 0; i < g_obN; i++)
      if(g_ob[i].state == ST_ACTIVE || g_ob[i].state == ST_TESTED) g_ob[i].state = ST_EXPIRED;

   if(g_bosN >= MAX_BOS)
   {
      for(int i = 1; i < g_bosN; i++) g_bos[i - 1] = g_bos[i];
      g_bosN--;
   }
   g_idSeq++;
   SBoS b;
   b.time      = iTime(_Symbol, TF_Structure, run);
   b.id        = "BOS" + IntegerToString(g_idSeq) + "_" + TimeToString(b.time, TIME_DATE | TIME_MINUTES);
   b.swingTime = swingTime;
   b.level     = level;
   b.bullish   = bull;
   b.state     = ST_ACTIVE;
   b.atr       = GetATR(h_atrStruct, 1);
   b.score     = Score_BoS;
   b.testCount = 0;
   b.lastTest  = 0;
   b.tierP     = 9.0;
   b.entered   = false;
   g_bos[g_bosN] = b;
   g_bosN++;

   // Order Block : last opposite candle before the break, body only (spec 2.2)
   for(int s = run + 1; s <= run + OB_ScanBars; s++)
   {
      double o = iOpen(_Symbol, TF_Structure, s);
      double c = iClose(_Symbol, TF_Structure, s);
      bool opposite = bull ? (c < o) : (c > o);
      if(!opposite) continue;
      if(g_obN >= MAX_OB)
      {
         for(int i = 1; i < g_obN; i++) g_ob[i - 1] = g_ob[i];
         g_obN--;
      }
      SOB ob;
      ob.id        = "OB" + IntegerToString(g_idSeq);
      ob.time      = iTime(_Symbol, TF_Structure, s);
      ob.high      = MathMax(o, c);
      ob.low       = MathMin(o, c);
      ob.bullish   = bull;
      ob.state     = ST_ACTIVE;
      ob.testCount = 0;
      ob.parentBoS = b.id;
      g_ob[g_obN] = ob;
      g_obN++;
      break;
   }
   PrintFormat("[%s] BoS %s confirmed level=%.2f swing=%s id=%s", EA_Name, bull ? "BULL" : "BEAR", level,
               TimeToString(swingTime, TIME_DATE | TIME_MINUTES), b.id);
   return true;
}

int FindOB(const string parent)
{
   for(int i = g_obN - 1; i >= 0; i--)
      if(g_ob[i].parentBoS == parent) return i;
   return -1;
}

// age / invalidation of BoS and OB on every new structure bar
void UpdateStructureStates()
{
   double c   = iClose(_Symbol, TF_Structure, 1);
   double atr = GetATR(h_atrStruct, 1);
   for(int i = 0; i < g_bosN; i++)
   {
      if(g_bos[i].state == ST_EXPIRED || g_bos[i].state == ST_BROKEN) continue;
      int age = iBarShift(_Symbol, TF_Structure, g_bos[i].time, false);
      if(age > BoS_MaxAgeBars) { g_bos[i].state = ST_EXPIRED; continue; }
      if(atr > 0.0)
      {
         if(g_bos[i].bullish  && c < g_bos[i].level - BoS_InvalidATR * atr) g_bos[i].state = ST_BROKEN;
         if(!g_bos[i].bullish && c > g_bos[i].level + BoS_InvalidATR * atr) g_bos[i].state = ST_BROKEN;
      }
   }
   for(int i = 0; i < g_obN; i++)
   {
      if(g_ob[i].state == ST_EXPIRED || g_ob[i].state == ST_BROKEN) continue;
      int age = iBarShift(_Symbol, TF_Structure, g_ob[i].time, false);
      if(age > OB_MaxAgeBars) g_ob[i].state = ST_EXPIRED;
   }
}

// OB invalidation on execution-TF closes
void UpdateOBStates()
{
   double c = iClose(_Symbol, TF_Execution, 1);
   for(int i = 0; i < g_obN; i++)
   {
      if(g_ob[i].state != ST_ACTIVE && g_ob[i].state != ST_TESTED) continue;
      if(g_ob[i].bullish  && c < g_ob[i].low)  g_ob[i].state = ST_BROKEN;
      if(!g_ob[i].bullish && c > g_ob[i].high) g_ob[i].state = ST_BROKEN;
   }
}

//+------------------------------------------------------------------+
//| Kicker (spec 2.3) on the execution TF                            |
//+------------------------------------------------------------------+
bool IsKicker(const bool bullish, const double atr)
{
   if(atr <= 0.0) return false;
   double o1 = iOpen(_Symbol, TF_Execution, 1),  c1 = iClose(_Symbol, TF_Execution, 1);
   double h1 = iHigh(_Symbol, TF_Execution, 1),  l1 = iLow(_Symbol, TF_Execution, 1);
   double o2 = iOpen(_Symbol, TF_Execution, 2),  c2 = iClose(_Symbol, TF_Execution, 2);
   double body1 = MathAbs(c1 - o1);
   if(body1 <= 0.0) return false;
   if(MathAbs(o1 - c2) < Kicker_GapATR * atr) return false;
   double top1 = MathMax(o1, c1), bot1 = MathMin(o1, c1);
   double top2 = MathMax(o2, c2), bot2 = MathMin(o2, c2);
   if(!(top1 >= top2 && bot1 <= bot2)) return false;   // body 1 fully engulfs body 2
   if(bullish)
   {
      if(!(c2 < o2 && c1 > o1)) return false;
      if((bot1 - l1) > Kicker_WickFrac * body1) return false;
   }
   else
   {
      if(!(c2 > o2 && c1 < o1)) return false;
      if((h1 - top1) > Kicker_WickFrac * body1) return false;
   }
   return true;
}

void UpdateVolStats()
{
   g_atrExpanding = false;
   g_atrSpike = false;
   double a[];
   ArraySetAsSeries(a, true);
   if(CopyBuffer(h_atrExec, 0, 1, 52, a) != 52) return;
   double s10 = 0.0, s50 = 0.0;
   for(int i = 1; i <= 10; i++) s10 += a[i];
   for(int i = 1; i <= 50; i++) s50 += a[i];
   s10 /= 10.0;
   s50 /= 50.0;
   g_atrExpanding = (a[0] > s10);
   g_atrSpike     = (s50 > 0.0 && a[0] > Spike_Mult * s50);
}

void DetectGap()
{
   double atr = g_atrExec;
   if(atr <= 0.0) return;
   double gap = MathAbs(iOpen(_Symbol, TF_Execution, 1) - iClose(_Symbol, TF_Execution, 2));
   if(gap > Gap_ATRMult * atr)
   {
      g_gapWaitUntil = iTime(_Symbol, TF_Execution, 0) + (datetime)(PeriodSeconds(TF_Execution) * Gap_WaitBars);
      PrintFormat("[%s] gap %.2f > ATR x %.1f : waiting %d bar(s)", EA_Name, gap, Gap_ATRMult, Gap_WaitBars);
   }
}

//+------------------------------------------------------------------+
//| External macro : US10Y + DXY                                     |
//+------------------------------------------------------------------+
bool SymbolOK(const string name)
{
   if(StringLen(name) == 0) return false;
   return SymbolSelect(name, true);
}

string ResolveSymbol(const string preferred, const string candidates)
{
   if(StringLen(preferred) > 0)
      return SymbolOK(preferred) ? preferred : "";
   string list[];
   int n = StringSplit(candidates, ',', list);
   for(int i = 0; i < n; i++)
   {
      string s = list[i];
      StringTrimLeft(s);
      StringTrimRight(s);
      if(SymbolOK(s)) return s;
   }
   return "";
}

bool LoadSeries(const string sym, const ENUM_TIMEFRAMES tf, const int n, double &out[])
{
   ArraySetAsSeries(out, false);
   ArrayResize(out, n);
   int got = CopyClose(sym, tf, 1, n, out);
   return (got == n);
}

// DXY = 50.14348112 * EURUSD^-0.576 * USDJPY^0.136 * GBPUSD^-0.119 * USDCAD^0.091 * USDSEK^0.042 * USDCHF^0.036
bool BuildSyntheticDXY(const ENUM_TIMEFRAMES tf, const int n, double &out[])
{
   string base[6] = {"EURUSD", "USDJPY", "GBPUSD", "USDCAD", "USDSEK", "USDCHF"};
   double w[6]    = {-0.576, 0.136, -0.119, 0.091, 0.042, 0.036};
   string sym[6];
   for(int p = 0; p < 6; p++) sym[p] = base[p] + DXY_PairSuffix;

   datetime tm[];
   ArraySetAsSeries(tm, false);
   ArrayResize(tm, n);
   if(CopyTime(sym[0], tf, 1, n, tm) != n) return false;

   ArraySetAsSeries(out, false);
   ArrayResize(out, n);
   for(int k = 0; k < n; k++)
   {
      double v = 50.14348112;
      for(int p = 0; p < 6; p++)
      {
         int sh = iBarShift(sym[p], tf, tm[k], false);
         if(sh < 0) return false;
         double c = iClose(sym[p], tf, sh);
         if(c <= 0.0) return false;
         v *= MathPow(c, w[p]);
      }
      out[k] = v;
   }
   return true;
}

// momentum of the last K bars, normalised by the volatility of the bar-to-bar change
double MomentumZ(double &a[], const int n, const int K)
{
   if(n < K + 2) return 0.0;
   int V = n - 1;
   double sum = 0.0, sum2 = 0.0;
   for(int i = 1; i < n; i++)
   {
      double d = a[i] - a[i - 1];
      sum  += d;
      sum2 += d * d;
   }
   double mean = sum / V;
   double var  = sum2 / V - mean * mean;
   if(var <= 0.0) return 0.0;
   double sd  = MathSqrt(var);
   double mom = a[n - 1] - a[n - 1 - K];
   return mom / (sd * MathSqrt((double)K));
}

void InitMacro()
{
   g_dxySym = "";
   g_dxySynth = false;
   g_y10Sym = "";
   g_mac.valid = false; g_mac.okD = false; g_mac.okY = false; g_mac.synth = false;
   g_mac.zD = 0.0; g_mac.zY = 0.0; g_mac.g = 0.0; g_mac.bias = 0; g_mac.strong = false; g_mac.stamp = 0;
   if(Macro_Mode == MACRO_OFF) return;

   g_dxySym = ResolveSymbol(DXY_Symbol, "USDX,DXY,USDIDX,USIDX,DX,DOLLAR_INDEX,USDOLLAR,DXY.cash,USDX.cash");
   if(g_dxySym == "" && DXY_UseSynthetic)
   {
      string base[6] = {"EURUSD", "USDJPY", "GBPUSD", "USDCAD", "USDSEK", "USDCHF"};
      bool all = true;
      for(int p = 0; p < 6; p++)
         if(!SymbolOK(base[p] + DXY_PairSuffix)) all = false;
      g_dxySynth = all;
   }
   g_y10Sym = ResolveSymbol(US10Y_Symbol, "US10Y,UST10Y,USB10Y,US10YR,USTNOTE,TNOTE,ZN,USTBOND10");

   string dxyName = (g_dxySym != "") ? g_dxySym : (g_dxySynth ? "(synthetic 6-pair)" : "(none)");
   string y10Name = (g_y10Sym != "") ? g_y10Sym : "(none)";
   PrintFormat("[%s] macro sources: DXY=%s  US10Y=%s", EA_Name, dxyName, y10Name);
   if(g_dxySym == "" && !g_dxySynth)
      Print("[", EA_Name, "] WARNING: no DXY source. Set DXY_Symbol to the broker's dollar-index symbol (check Market Watch).");
   if(g_y10Sym == "")
      Print("[", EA_Name, "] WARNING: no US10Y source. Set US10Y_Symbol to the broker's 10Y symbol (check Market Watch).");
}

void UpdateMacro()
{
   if(Macro_Mode == MACRO_OFF) return;
   datetime t = iTime(_Symbol, TF_Macro, 0);
   if(g_mac.valid && t == g_mac.stamp) return;   // once per macro bar

   int n = Macro_VolWindow + 1;
   if(n < Macro_Lookback + 2) n = Macro_Lookback + 2;
   double a[];

   g_mac.okD = false; g_mac.okY = false; g_mac.synth = false;
   g_mac.zD = 0.0; g_mac.zY = 0.0;

   if(g_dxySym != "")
   {
      if(LoadSeries(g_dxySym, TF_Macro, n, a))
      {
         g_mac.zD = MomentumZ(a, n, Macro_Lookback);
         g_mac.okD = true;
      }
   }
   else if(g_dxySynth)
   {
      if(BuildSyntheticDXY(TF_Macro, n, a))
      {
         g_mac.zD = MomentumZ(a, n, Macro_Lookback);
         g_mac.okD = true;
         g_mac.synth = true;
      }
   }
   if(g_y10Sym != "")
   {
      if(LoadSeries(g_y10Sym, TF_Macro, n, a))
      {
         double z = MomentumZ(a, n, Macro_Lookback);
         g_mac.zY = US10Y_IsPrice ? -z : z;   // convert bond price momentum to yield momentum
         g_mac.okY = true;
      }
   }

   double wsum = 0.0, acc = 0.0;
   if(g_mac.okD) { acc += Macro_W_DXY   * (-g_mac.zD); wsum += Macro_W_DXY; }
   if(g_mac.okY) { acc += Macro_W_Yield * (-g_mac.zY); wsum += Macro_W_Yield; }

   if(wsum <= 0.0)
   {
      g_mac.g = 0.0; g_mac.bias = 0; g_mac.strong = false;
      g_mac.valid = false;       // retry on the next execution bar
      if(!g_macroWarned)
      {
         Print("[", EA_Name, "] macro data not available yet (symbol history may still be syncing).");
         g_macroWarned = true;
      }
      return;
   }
   g_mac.g = acc / wsum;
   g_mac.bias = (g_mac.g >= Macro_Threshold) ? 1 : ((g_mac.g <= -Macro_Threshold) ? -1 : 0);
   g_mac.strong = (MathAbs(g_mac.g) >= Macro_StrongThr);
   g_mac.stamp = t;
   g_mac.valid = true;
   g_macroWarned = false;
}

// returns false when the macro view blocks the trade; 'delta' is added to the score
bool MacroGate(const int dir, double &delta, string &why)
{
   delta = 0.0;
   why = "";
   if(Macro_Mode == MACRO_OFF) return true;
   if(!g_mac.valid)
   {
      if(Macro_BlockIfMissing) { why = "macro data missing"; return false; }
      return true;
   }
   int rel = (g_mac.bias == 0) ? 0 : ((g_mac.bias == dir) ? 1 : -1);
   switch(Macro_Mode)
   {
      case MACRO_SCORE:
         if(rel > 0) delta = Macro_Bonus;
         else if(rel < 0) delta = -Macro_Penalty;
         break;
      case MACRO_FILTER:
         if(rel < 0) { why = "macro against"; return false; }
         if(rel > 0) delta = Macro_Bonus;
         break;
      case MACRO_STRICT:
         if(rel <= 0) { why = "macro not aligned"; return false; }
         delta = Macro_Bonus;
         break;
      default:
         break;
   }
   if(Macro_BlockStrong && g_mac.strong && rel < 0) { why = "strong macro conflict"; return false; }
   return true;
}

//+------------------------------------------------------------------+
//| Entry                                                            |
//+------------------------------------------------------------------+
bool EntryAllowed(string &why)
{
   why = "";
   if(CountPositions() >= MaxPositions) { why = "max positions"; return false; }
   if(TimeCurrent() < g_gapWaitUntil)   { why = "gap wait"; return false; }
   if(g_atrSpike)                       { why = "ATR spike"; return false; }
   long spr = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
   if(spr > MaxSpreadPts)               { why = "spread"; return false; }

   datetime gmt = ServerToGMT(TimeCurrent());
   double h = GMTHour(gmt);
   double ss, se, cs, ce;
   SessionTimes(gmt, ss, se, cs, ce);
   if(!InRange(h, ss, se))              { why = "outside session"; return false; }
   if(h < ss + Boundary_Min / 60.0)     { why = "session start boundary"; return false; }
   if(h > se - Boundary_Min / 60.0)     { why = "session end boundary"; return false; }
   int dow = GMTDow(gmt);
   if(dow == 0 || dow == 6)             { why = "weekend"; return false; }
   if(FridayFlat && dow == 5 && h >= se - 1.0) { why = "friday cutoff"; return false; }
   if(InNewsBlackout(gmt))              { why = "news blackout"; return false; }
   return true;
}

double CalcLots(const double riskPct, const double slDist)
{
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   double tickValue = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   if(tickSize <= 0.0 || tickValue <= 0.0 || slDist <= 0.0) return 0.0;
   double riskMoney = AccountInfoDouble(ACCOUNT_EQUITY) * riskPct / 100.0;
   double lossPerLot = slDist / tickSize * tickValue;
   if(lossPerLot <= 0.0) return 0.0;
   double lots = riskMoney / lossPerLot;
   if(lots > MaxLots) lots = MaxLots;
   double v = NormVol(lots);
   if(v <= 0.0)
   {
      double mn = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
      if(mn * lossPerLot <= riskMoney * 1.5) v = mn;   // allow min lot if risk stays within 1.5x
   }
   return v;
}

void EvaluateEntry()
{
   if(g_trend == 0) return;
   int dir = g_trend;
   bool bull = (dir > 0);

   string why;
   if(!EntryAllowed(why)) return;
   if(Use_D1_Bias && g_d1Dir != 0 && g_d1Dir != dir) return;

   // newest live BoS in the trend direction
   int bi = -1;
   for(int i = g_bosN - 1; i >= 0; i--)
   {
      if(g_bos[i].bullish != bull) continue;
      if(g_bos[i].state == ST_ACTIVE || g_bos[i].state == ST_TESTED) { bi = i; break; }
   }
   if(bi < 0) return;

   double atr4 = GetATR(h_atrStruct, 1);
   double atr1 = g_atrExec;
   if(atr4 <= 0.0 || atr1 <= 0.0) return;

   double level = g_bos[bi].level;
   double o1 = iOpen(_Symbol, TF_Execution, 1),  c1 = iClose(_Symbol, TF_Execution, 1);
   double h1 = iHigh(_Symbol, TF_Execution, 1),  l1 = iLow(_Symbol, TF_Execution, 1);

   double ext  = bull ? l1 : h1;
   double dist = MathAbs(ext - level) / atr4;

   int oi = FindOB(g_bos[bi].id);
   bool obLive = (oi >= 0 && (g_ob[oi].state == ST_ACTIVE || g_ob[oi].state == ST_TESTED));
   bool obTouch = false;
   if(obLive)
   {
      if(bull) obTouch = (l1 <= g_ob[oi].high && l1 >= g_ob[oi].low - 0.25 * atr4);
      else     obTouch = (h1 >= g_ob[oi].low  && h1 <= g_ob[oi].high + 0.25 * atr4);
   }
   bool lvlTouch = (dist <= Retest_Tier4);

   // --- register a distinct test event (spec 2.4 count limit) ---
   if(lvlTouch || obTouch)
   {
      int gap = 9999;
      if(g_bos[bi].lastTest != 0)
         gap = iBarShift(_Symbol, TF_Execution, g_bos[bi].lastTest, false) - 1;
      if(gap >= Retest_MinGapBars)
      {
         g_bos[bi].testCount++;
         g_bos[bi].lastTest = iTime(_Symbol, TF_Execution, 1);
         g_bos[bi].state = ST_TESTED;
         g_bos[bi].entered = false;
         double pt = lvlTouch ? dist : 9.0;
         if(obTouch) pt = MathMin(pt, Retest_Tier2);
         g_bos[bi].tierP = pt;
         if(obLive && obTouch)
         {
            g_ob[oi].testCount++;
            g_ob[oi].state = (g_ob[oi].testCount >= OB_MaxTests) ? ST_EXPIRED : ST_TESTED;
         }
      }
   }
   if(g_bos[bi].testCount == 0 || g_bos[bi].entered) return;
   int since = iBarShift(_Symbol, TF_Execution, g_bos[bi].lastTest, false) - 1;
   if(since > Retest_WindowBars) return;
   if(g_bos[bi].testCount >= 3 && !Retest_AllowThird) return;

   double p = g_bos[bi].tierP;
   if(p > Retest_Tier4) return;
   if(p > Retest_Tier3 && !Retest_AllowTier4) return;

   // --- rebound sign on the execution TF (spec 2.5 mandatory) ---
   bool rebound = bull ? (c1 > o1 && c1 > level) : (c1 < o1 && c1 < level);
   if(!rebound) return;

   // --- auxiliary conditions (spec 2.5) ---
   datetime gmt = ServerToGMT(TimeCurrent());
   double hh = GMTHour(gmt);
   double ss, se, cs, ce;
   SessionTimes(gmt, ss, se, cs, ce);
   bool inCore  = InRange(hh, cs, ce);
   bool kicker  = IsKicker(bull, atr1);
   if(!(kicker || g_atrExpanding || inCore)) return;
   if(p > Retest_Tier2 && p <= Retest_Tier3 && !(inCore && g_atrExpanding)) return;   // mid precision

   // --- score (spec 2.3) ---
   int score = Score_BoS;
   if(obLive)
   {
      int age = iBarShift(_Symbol, TF_Structure, g_ob[oi].time, false);
      score += (age <= OB_FreshBars) ? Score_OB_Fresh : Score_OB_Old;
   }
   score += Score_Retest;
   if(kicker) score += Kicker_Bonus;
   if(score > 100) score = 100;
   int tc = g_bos[bi].testCount;
   double conf = (tc <= 1) ? Conf_Test1 : ((tc == 2) ? Conf_Test2 : Conf_Test3);
   double sc = score * conf;
   if(p > Retest_Tier1 && p <= Retest_Tier2 && !kicker) sc -= NoKickerPenalty;

   double mdelta = 0.0;
   if(!MacroGate(dir, mdelta, why))
   {
      PrintFormat("[%s] entry blocked by macro: %s (g=%.2f DXYz=%.2f Yz=%.2f)", EA_Name, why, g_mac.g, g_mac.zD, g_mac.zY);
      return;
   }
   sc += mdelta;
   if(sc > 100.0) sc = 100.0;
   if(sc < 0.0) sc = 0.0;
   int fs = (int)MathRound(sc);
   if(fs < Score_Min) return;

   double riskPct = (fs >= 80) ? Risk_Score80 : ((fs >= 60) ? Risk_Score60 : Risk_Score50);

   // --- order ---
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   if(ask <= 0.0 || bid <= 0.0) return;
   double slDist = atr1 * SL_ATR;
   double price  = bull ? ask : bid;
   double sl     = NormalizeDouble(bull ? price - slDist : price + slDist, _Digits);
   double lots   = CalcLots(riskPct, slDist);
   if(lots <= 0.0) { Print("[", EA_Name, "] lot size resolved to 0, skip."); return; }

   double margin = 0.0;
   if(OrderCalcMargin(bull ? ORDER_TYPE_BUY : ORDER_TYPE_SELL, _Symbol, lots, price, margin))
      if(margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.9) { Print("[", EA_Name, "] not enough free margin, skip."); return; }

   g_pend.valid = true;
   g_pend.atr   = atr1;
   g_pend.score = fs;
   g_pend.obx   = obLive ? (bull ? g_ob[oi].low : g_ob[oi].high) : 0.0;

   string cmt = StringFormat("%s S%d", EA_Name, fs);
   bool ok = bull ? trade.Buy(lots, _Symbol, 0.0, sl, 0.0, cmt) : trade.Sell(lots, _Symbol, 0.0, sl, 0.0, cmt);
   if(!ok || (trade.ResultRetcode() != TRADE_RETCODE_DONE && trade.ResultRetcode() != TRADE_RETCODE_PLACED))
   {
      PrintFormat("[%s] order failed: %d %s", EA_Name, trade.ResultRetcode(), trade.ResultRetcodeDescription());
      g_pend.valid = false;
      return;
   }
   g_bos[bi].entered = true;
   PrintFormat("[%s] ENTRY %s lots=%.2f sl=%.2f score=%d (base=%d conf=%.2f macro=%+.0f) tier=%.2f test#%d kicker=%s  macro g=%.2f DXYz=%.2f Yz=%.2f",
               EA_Name, bull ? "BUY" : "SELL", lots, sl, fs, score, conf, mdelta, p, tc, kicker ? "Y" : "N",
               g_mac.g, g_mac.zD, g_mac.zY);
}

//+------------------------------------------------------------------+
//| Position management (partials, trail, forced exits)              |
//+------------------------------------------------------------------+
void CheckOBBreakExits()
{
   double c   = iClose(_Symbol, TF_Execution, 1);
   double atr = g_atrExec;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(!PositionSelectByTicket(tk)) continue;
      if(!IsMyPosition()) continue;
      EnsureState(tk);
      double obx = GVD(tk, "obx", 0.0);
      int f = (int)GVD(tk, "flags", 0);
      if(obx <= 0.0 || (f & 1) != 0) continue;
      long type = PositionGetInteger(POSITION_TYPE);
      bool broken = (type == POSITION_TYPE_BUY)  ? (c < obx - OB_BreakATR * atr)
                                                  : (c > obx + OB_BreakATR * atr);
      if(!broken) continue;
      ClosePartialFrac(tk, 0.5, "OB break");
      f |= 1;
      GVS(tk, "flags", f);
   }
}

void ManagePositions()
{
   if(PositionsTotal() == 0) return;

   datetime now = TimeCurrent();
   datetime gmt = ServerToGMT(now);
   double gh = GMTHour(gmt);
   int dow = GMTDow(gmt);
   double ss, se, cs, ce;
   SessionTimes(gmt, ss, se, cs, ce);
   bool inSession  = InRange(gh, ss, se);
   bool fridayFlat = (FridayFlat && dow == 5 && gh >= se);

   double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
   double stopLvl = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL) * _Point;

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(!PositionSelectByTicket(tk)) continue;
      if(!IsMyPosition()) continue;
      EnsureState(tk);

      long   type = PositionGetInteger(POSITION_TYPE);
      bool   isBuy = (type == POSITION_TYPE_BUY);
      double open = 0.0, sl = 0.0, tp = 0.0;
      if(!PositionGetDouble(POSITION_PRICE_OPEN, open)) continue;
      PositionGetDouble(POSITION_SL, sl);
      PositionGetDouble(POSITION_TP, tp);
      datetime opened = (datetime)PositionGetInteger(POSITION_TIME);

      // 1) forced exits
      if(fridayFlat) { ClosePos(tk, "friday NY 12:00 flat"); continue; }
      if(MaxHoldHours > 0 && now - opened > (datetime)(MaxHoldHours * 3600)) { ClosePos(tk, "max hold time"); continue; }

      int f = (int)GVD(tk, "flags", 0);
      if(inSession)
      {
         if((f & 4) != 0) { f &= ~4; GVS(tk, "flags", f); }
      }
      else if(SessionEnd_Action > 0 && (f & 4) == 0)
      {
         if(SessionEnd_Action == 2) { ClosePos(tk, "session end"); continue; }
         ClosePartialFrac(tk, 0.5, "session end reduce");
         f |= 4;
         GVS(tk, "flags", f);
         if(!PositionSelectByTicket(tk)) continue;
      }

      // 2) staged take profit (ATR of entry)
      double atrE = GVD(tk, "atr", g_atrExec);
      int stage = (int)GVD(tk, "stage", 0);
      double initVol = GVD(tk, "vol", 0.0);
      double profit = isBuy ? (bid - open) : (open - ask);

      if(stage < 1 && profit >= TP1_ATR * atrE)
      {
         ClosePartialVol(tk, initVol * TP_ClosePct / 100.0, "TP1");
         stage = 1; GVS(tk, "stage", stage);
         if(!PositionSelectByTicket(tk)) continue;
      }
      if(stage < 2 && profit >= TP2_ATR * atrE)
      {
         ClosePartialVol(tk, initVol * TP_ClosePct / 100.0, "TP2");
         stage = 2; GVS(tk, "stage", stage);
         if(!PositionSelectByTicket(tk)) continue;
      }
      if(stage < 3 && profit >= TP3_ATR * atrE)
      {
         ClosePartialVol(tk, initVol * TP_ClosePct / 100.0, "TP3");
         stage = 3; GVS(tk, "stage", stage);
         if(!PositionSelectByTicket(tk)) continue;
      }

      // 3) trailing : starts at TP1 (or after D1 reversal), breakeven floor
      f = (int)GVD(tk, "flags", 0);
      if(stage >= 1 || (f & 8) != 0)
      {
         double atr = (g_atrExec > 0.0) ? g_atrExec : atrE;
         double mult = Trail_ATR * (((f & 8) != 0) ? Trail_Tighten : 1.0);
         PositionGetDouble(POSITION_SL, sl);
         PositionGetDouble(POSITION_TP, tp);
         if(isBuy)
         {
            double nsl = MathMax(bid - atr * mult, open + BE_BufferPts * _Point);
            nsl = NormalizeDouble(nsl, _Digits);
            if(nsl > sl + _Point && nsl < bid - stopLvl)
               if(!trade.PositionModify(tk, nsl, tp))
                  PrintFormat("[%s] trail modify #%I64u failed: %d", EA_Name, tk, trade.ResultRetcode());
         }
         else
         {
            double nsl = MathMin(ask + atr * mult, open - BE_BufferPts * _Point);
            nsl = NormalizeDouble(nsl, _Digits);
            if((sl <= 0.0 || nsl < sl - _Point) && nsl > ask + stopLvl)
               if(!trade.PositionModify(tk, nsl, tp))
                  PrintFormat("[%s] trail modify #%I64u failed: %d", EA_Name, tk, trade.ResultRetcode());
         }
      }
   }
}

//+------------------------------------------------------------------+
//| Bar events                                                       |
//+------------------------------------------------------------------+
void OnDirectionBar()
{
   SSwing hi[], lo[];
   CollectSwings(TF_Direction, Swing_Len_D1, 120, true,  3, hi);
   CollectSwings(TF_Direction, Swing_Len_D1, 120, false, 3, lo);
   int dir = 0, run = 0;
   double lv = 0.0;
   datetime st = 0;
   if(DetectBoS(TF_Direction, h_atrDir, hi, lo, dir, lv, st, run))
   {
      if(st != g_d1SwingTime || dir != g_d1Dir)
      {
         g_d1SwingTime = st;
         g_d1Dir = dir;
         PrintFormat("[%s] D1 BoS %s level=%.2f", EA_Name, dir > 0 ? "BULL" : "BEAR", lv);
         ApplyD1Reverse(dir);
      }
   }
}

void OnStructureBar()
{
   SSwing hi[], lo[];
   CollectSwings(TF_Structure, Swing_Len_H4, Swing_ScanBars, true,  Trend_Rises + 1, hi);
   CollectSwings(TF_Structure, Swing_Len_H4, Swing_ScanBars, false, Trend_Rises + 1, lo);
   g_trend = TrendFromSwings(hi, lo, Trend_Rises);

   UpdateStructureStates();

   int dir = 0, run = 0;
   double lv = 0.0;
   datetime st = 0;
   if(DetectBoS(TF_Structure, h_atrStruct, hi, lo, dir, lv, st, run))
   {
      if(RegisterBoS(dir, lv, st, run))
         CloseOpposite(dir);       // reverse BoS = highest priority exit
   }
}

void DrawHUD()
{
   string s = EA_Name + "\n";
   s += StringFormat("H4 trend: %s | D1 BoS: %s | live BoS: ",
                     g_trend > 0 ? "UP" : (g_trend < 0 ? "DOWN" : "RANGE"),
                     g_d1Dir > 0 ? "BULL" : (g_d1Dir < 0 ? "BEAR" : "-"));
   int bi = -1;
   for(int i = g_bosN - 1; i >= 0; i--)
      if(g_bos[i].state == ST_ACTIVE || g_bos[i].state == ST_TESTED) { bi = i; break; }
   if(bi >= 0)
      s += StringFormat("%s @%.2f tests=%d\n", g_bos[bi].bullish ? "BULL" : "BEAR", g_bos[bi].level, g_bos[bi].testCount);
   else
      s += "none\n";
   if(Macro_Mode == MACRO_OFF)
      s += "Macro: OFF\n";
   else if(!g_mac.valid)
      s += "Macro: no data\n";
   else
      s += StringFormat("Macro: gold-bias %s  g=%.2f | DXY z=%.2f%s | US10Y z=%.2f%s\n",
                        g_mac.bias > 0 ? "BULL" : (g_mac.bias < 0 ? "BEAR" : "NEUTRAL"), g_mac.g,
                        g_mac.zD, g_mac.okD ? (g_mac.synth ? "(syn)" : "") : "(n/a)",
                        g_mac.zY, g_mac.okY ? "" : "(n/a)");
   Comment(s);
}

void OnExecBar()
{
   g_atrExec = GetATR(h_atrExec, 1);
   UpdateVolStats();
   UpdateMacro();
   UpdateOBStates();
   if(g_atrExec > 0.0)
   {
      CheckOBBreakExits();
      DetectGap();
   }
   CleanupState();
   EvaluateEntry();
   DrawHUD();
}

//+------------------------------------------------------------------+
//| Standard events                                                  |
//+------------------------------------------------------------------+
int OnInit()
{
   if(Swing_Len_H4 < 2 || Swing_ScanBars < 10 || Trend_Rises < 1 || ATR_Period < 2)
   {
      Print("[", EA_Name, "] invalid structure inputs.");
      return INIT_PARAMETERS_INCORRECT;
   }
   if(StringFind(_Symbol, "XAU") < 0 && StringFind(_Symbol, "GOLD") < 0)
      Print("[", EA_Name, "] WARNING: designed for XAUUSD/GOLD, current symbol is ", _Symbol);

   h_atrExec   = iATR(_Symbol, TF_Execution, ATR_Period);
   h_atrStruct = iATR(_Symbol, TF_Structure, ATR_Period);
   h_atrDir    = iATR(_Symbol, TF_Direction, ATR_Period);
   if(h_atrExec == INVALID_HANDLE || h_atrStruct == INVALID_HANDLE || h_atrDir == INVALID_HANDLE)
   {
      Print("[", EA_Name, "] failed to create ATR handles.");
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(MagicNumber);
   trade.SetDeviationInPoints(DeviationPts);
   trade.SetTypeFillingBySymbol(_Symbol);

   g_pend.valid = false; g_pend.atr = 0.0; g_pend.obx = 0.0; g_pend.score = 0;
   g_bosN = 0; g_obN = 0; g_idSeq = 0;
   g_lastDirBar = 0; g_lastStructBar = 0; g_lastExecBar = 0;
   g_trend = 0; g_d1Dir = 0; g_d1SwingTime = 0;
   g_gapWaitUntil = 0;

   ParseNews();
   InitMacro();

   PrintFormat("[%s] initialised on %s magic=%d macro_mode=%d", EA_Name, _Symbol, MagicNumber, (int)Macro_Mode);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   if(h_atrExec   != INVALID_HANDLE) IndicatorRelease(h_atrExec);
   if(h_atrStruct != INVALID_HANDLE) IndicatorRelease(h_atrStruct);
   if(h_atrDir    != INVALID_HANDLE) IndicatorRelease(h_atrDir);
   Comment("");
}

void OnTick()
{
   ManagePositions();

   datetime tD = iTime(_Symbol, TF_Direction, 0);
   if(tD != 0 && tD != g_lastDirBar)
   {
      g_lastDirBar = tD;
      OnDirectionBar();
   }
   datetime tS = iTime(_Symbol, TF_Structure, 0);
   if(tS != 0 && tS != g_lastStructBar)
   {
      g_lastStructBar = tS;
      OnStructureBar();
   }
   datetime tE = iTime(_Symbol, TF_Execution, 0);
   if(tE != 0 && tE != g_lastExecBar)
   {
      g_lastExecBar = tE;
      OnExecBar();
   }
}
//+------------------------------------------------------------------+
