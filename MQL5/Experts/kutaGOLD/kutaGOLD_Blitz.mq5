//+------------------------------------------------------------------+
//| kutaGOLD_Blitz.mq5                                               |
//| XAUUSD 短期特化EA（M5執行 / M15バイアス / H1フィルター）         |
//|                                                                  |
//| エンジンA: Liquidity Sweep Reversal（ストップ狩り逆張り）        |
//| エンジンB: Trend Pullback（M15トレンド方向へのM5押し目・戻り）   |
//|                                                                  |
//| 設計思想:                                                        |
//|  - 大きいトレンドを長く持たない。1R到達で半分利確＋建値化        |
//|  - 伸びない玉はタイムストップで切る（ジワジワ削られるのを防ぐ）  |
//|  - ロンドン/NYのみ稼働、持ち越しなし、指標前後は停止             |
//|  - アジア時間ブレイクアウトは使わない                            |
//+------------------------------------------------------------------+
#property copyright "kutaGOLD"
#property version   "1.00"
#property description "kutaGOLD Blitz - XAUUSD short-term (Sweep Reversal + Trend Pullback)"

#include <Trade/Trade.mqh>

//==================== Inputs ====================
input group "=== 基本 ==="
input string          InpEAName          = "kutaGOLD Blitz";
input long            InpMagic           = 5100001;     // 51=Blitz v1 / 00=環境 / 01=XAUUSD
input int             InpDeviationPts    = 30;          // 許容スリッページ(points)

input group "=== 時間足 ==="
input ENUM_TIMEFRAMES InpExecTF          = PERIOD_M5;   // 執行足
input ENUM_TIMEFRAMES InpBiasTF          = PERIOD_M15;  // バイアス足
input ENUM_TIMEFRAMES InpHTF             = PERIOD_H1;   // 上位フィルター足

input group "=== 資金管理 ==="
input double          InpRiskPct         = 0.5;         // 1トレードのリスク(% of Equity)
input double          InpMaxLot          = 5.0;         // 最大ロット
input double          InpDailyLossPct    = 2.0;         // 日次最大損失(%)で当日停止
input double          InpDailyProfitPct  = 4.0;         // 日次利益目標(%)で当日停止(0=無効)
input int             InpMaxTradesDay    = 6;           // 1日の最大エントリー数
input int             InpMaxConsecLoss   = 3;           // 連敗で当日停止
input int             InpCooldownBars    = 3;           // 負けの後の待機本数(執行足)

input group "=== セッション(GMT) ==="
input bool            InpAutoGMT         = true;        // ライブ時はサーバーGMTオフセット自動取得
input int             InpGMTOffsetWinter = 2;           // テスター用: 冬時間のサーバーGMTオフセット
input int             InpGMTOffsetSummer = 3;           // テスター用: 夏時間のサーバーGMTオフセット
input int             InpLonStartMin     = 420;         // ロンドン開始 GMT分 (07:00)
input int             InpLonEndMin       = 630;         // ロンドン終了 GMT分 (10:30)
input int             InpNYStartMin      = 750;         // NY開始 GMT分 (12:30)
input int             InpNYEndMin        = 960;         // NY終了 GMT分 (16:00)
input int             InpForceCloseMin   = 1200;        // 強制全決済 GMT分 (20:00) 持ち越しなし
input int             InpFridayCloseMin  = 1140;        // 金曜 強制全決済 GMT分 (19:00)

input group "=== 環境フィルター ==="
input int             InpMaxSpreadPts    = 35;          // 最大スプレッド(points)
input int             InpATRPeriod       = 14;          // ATR期間(執行足)
input int             InpATRSlowPeriod   = 100;         // 基準ATR期間(執行足)
input double          InpATRRatioMin     = 0.7;         // ATR/基準ATR の下限(閑散回避)
input double          InpATRRatioMax     = 2.5;         // ATR/基準ATR の上限(暴走回避)
input double          InpSpikeATR        = 3.0;         // 直近足の値幅がATR×これ以上なら見送り
input int             InpSpikePauseBars  = 3;           // スパイク後の待機本数

input group "=== 指標回避 ==="
input bool            InpUseCalendar     = true;        // MT5経済カレンダー(USD高重要度)を使用 ※ライブのみ
input string          InpManualNews      = "";          // 手動指標(GMT) 例 "2026.10.02 12:30;2026.10.15 12:30"
input int             InpNewsBeforeMin   = 30;          // 指標前 新規停止(分)
input int             InpNewsAfterMin    = 30;          // 指標後 新規停止(分)
input bool            InpNewsFlatten     = true;        // 指標5分前に保有玉を決済

input group "=== バイアス ==="
input int             InpBiasEMA         = 50;          // バイアス足EMA
input int             InpHTFEMA          = 200;         // 上位足EMA
input int             InpADXPeriod       = 14;          // バイアス足ADX期間
input double          InpADXTrend        = 22.0;        // これ以上でトレンド判定
input double          InpADXStrong       = 35.0;        // これ以上で強トレンド(逆張り禁止)

input group "=== エンジンA: Liquidity Sweep ==="
input bool            InpUseSweep        = true;
input int             InpSweepLookback   = 36;          // スイング探索本数(執行足) 36本=3時間
input int             InpSweepMinAge     = 4;           // レベルが最低何本前に作られているか
input bool            InpSweepUsePDHL    = true;        // 前日高安も流動性レベルに使う
input double          InpSweepMinPierce  = 0.05;        // 突き抜け最小(ATR倍)
input double          InpSweepMaxPierce  = 0.8;         // 突き抜け最大(ATR倍) 超えたら本物のブレイク扱い
input double          InpSweepWickRatio  = 0.45;        // ヒゲ/値幅 の最小比率
input double          InpSweepMinRange   = 0.8;         // シグナル足の最小値幅(ATR倍)
input double          InpSweepSLBuf      = 0.15;        // SLバッファ(ATR倍)

input group "=== エンジンB: Trend Pullback ==="
input bool            InpUsePullback     = true;
input int             InpPBFastEMA       = 21;          // 執行足 押し目EMA
input int             InpPBSlowEMA       = 50;          // 執行足 トレンド床EMA
input bool            InpPBUseHTF        = true;        // 上位足EMA方向と一致必須
input int             InpRSIPeriod       = 7;
input double          InpPBRSIDip        = 45.0;        // 押し目中にRSIがこれ以下(売りは100-値以上)
input double          InpPBTouchATR      = 0.15;        // EMAタッチ判定の許容(ATR倍)
input double          InpPBMaxChaseATR   = 1.0;         // 終値がEMAからこれ以上離れていたら追わない
input double          InpPBSLBuf         = 0.2;         // SLバッファ(ATR倍)

input group "=== エグジット ==="
input double          InpMinSLATR        = 0.6;         // SL最小距離(ATR倍)
input double          InpMaxSLATR        = 2.0;         // SL最大距離(ATR倍) 超えたら見送り
input double          InpTP1R            = 1.0;         // TP1 (R倍) で部分利確
input double          InpTP1ClosePct     = 50.0;        // TP1での決済割合(%)
input double          InpBELockR         = 0.1;         // 建値移動時のロック(R倍)
input double          InpTP2R            = 2.5;         // 最終TP (R倍)
input double          InpTrailATR        = 1.0;         // TP1後のトレール幅(ATR倍)
input int             InpTimeStopBars    = 12;          // この本数でTP1未到達かつ伸びないなら撤退
input double          InpTimeStopMinR    = 0.3;         // タイムストップ判定の最低含み益(R倍)
input int             InpMaxHoldBars     = 48;          // 最大保有本数
input bool            InpCloseOnOpposite = true;        // 逆シグナルで決済

input group "=== 表示 ==="
input bool            InpShowHUD         = true;

//==================== Globals ====================
CTrade   trade;

int hATR = INVALID_HANDLE, hATRSlow = INVALID_HANDLE;
int hEMAFast = INVALID_HANDLE, hEMASlow = INVALID_HANDLE, hRSI = INVALID_HANDLE;
int hBiasEMA = INVALID_HANDLE, hADX = INVALID_HANDLE, hHTFEMA = INVALID_HANDLE;

datetime g_lastBar       = 0;
int      g_spikePause    = 0;
datetime g_manualNews[];
datetime g_calNews[];
datetime g_calLastLoad   = 0;

// 日次統計
double   g_dayPnL        = 0.0;
int      g_dayTrades     = 0;
int      g_consecLoss    = 0;
datetime g_lastLossTime  = 0;
datetime g_dayStart      = 0;
double   g_dayStartBal   = 0.0;

// HUD用
string   g_status        = "";
int      g_biasDir       = 0;
double   g_adx           = 0.0;
double   g_atr           = 0.0;
double   g_atrRatio      = 0.0;

//==================== Utility ====================
double Pt()   { return SymbolInfoDouble(_Symbol, SYMBOL_POINT); }
double Bid()  { return SymbolInfoDouble(_Symbol, SYMBOL_BID); }
double Ask()  { return SymbolInfoDouble(_Symbol, SYMBOL_ASK); }
int    Dig()  { return (int)SymbolInfoInteger(_Symbol, SYMBOL_DIGITS); }
double NP(double p) { return NormalizeDouble(p, Dig()); }

bool GetBuf(int handle, int buffer, int start, int count, double &arr[])
{
   ArraySetAsSeries(arr, true);
   return (CopyBuffer(handle, buffer, start, count, arr) == count);
}

// 米国夏時間判定（3月第2日曜〜11月第1日曜）
bool IsUSDST(datetime t)
{
   MqlDateTime d; TimeToStruct(t, d);
   if(d.mon < 3 || d.mon > 11) return false;
   if(d.mon > 3 && d.mon < 11) return true;
   MqlDateTime f = d; f.day = 1; f.hour = 0; f.min = 0; f.sec = 0;
   MqlDateTime f2; TimeToStruct(StructToTime(f), f2);
   int firstSunday = 1 + (7 - f2.day_of_week) % 7;
   if(d.mon == 3) return (d.day >= firstSunday + 7);
   return (d.day < firstSunday); // 11月
}

int ServerGMTOffsetHours()
{
   bool tester = (bool)MQLInfoInteger(MQL_TESTER);
   if(InpAutoGMT && !tester)
      return (int)MathRound((double)(TimeTradeServer() - TimeGMT()) / 3600.0);
   return IsUSDST(TimeCurrent()) ? InpGMTOffsetSummer : InpGMTOffsetWinter;
}

datetime NowGMT() { return TimeCurrent() - ServerGMTOffsetHours() * 3600; }

int GMTMinuteOfDay()
{
   MqlDateTime d; TimeToStruct(NowGMT(), d);
   return d.hour * 60 + d.min;
}

int GMTDayOfWeek()
{
   MqlDateTime d; TimeToStruct(NowGMT(), d);
   return d.day_of_week;
}

bool InWindow(int m, int s, int e) { return (s <= e) ? (m >= s && m < e) : (m >= s || m < e); }

bool InTradingSession()
{
   int dow = GMTDayOfWeek();
   if(dow == 0 || dow == 6) return false;
   int m = GMTMinuteOfDay();
   if(dow == 5 && m >= InpFridayCloseMin - 60) return false; // 金曜クローズ1時間前から新規なし
   return InWindow(m, InpLonStartMin, InpLonEndMin) || InWindow(m, InpNYStartMin, InpNYEndMin);
}

bool MustFlattenByTime()
{
   int dow = GMTDayOfWeek();
   int m   = GMTMinuteOfDay();
   if(dow == 5 && m >= InpFridayCloseMin) return true;
   return (m >= InpForceCloseMin);
}

//==================== News ====================
void ParseManualNews()
{
   ArrayResize(g_manualNews, 0);
   if(StringLen(InpManualNews) == 0) return;
   string parts[];
   int n = StringSplit(InpManualNews, ';', parts);
   for(int i = 0; i < n; i++)
   {
      string s = parts[i];
      StringTrimLeft(s); StringTrimRight(s);
      if(StringLen(s) == 0) continue;
      datetime t = StringToTime(s);
      if(t <= 0) continue;
      int k = ArraySize(g_manualNews);
      ArrayResize(g_manualNews, k + 1);
      g_manualNews[k] = t; // GMT
   }
}

void LoadCalendar()
{
   if(!InpUseCalendar || (bool)MQLInfoInteger(MQL_TESTER)) return;
   if(TimeCurrent() - g_calLastLoad < 900) return;
   g_calLastLoad = TimeCurrent();
   ArrayResize(g_calNews, 0);

   MqlCalendarValue values[];
   datetime from = TimeTradeServer() - 3600;
   datetime to   = TimeTradeServer() + 86400;
   if(CalendarValueHistory(values, from, to, NULL, "USD") <= 0) return;
   int offset = ServerGMTOffsetHours();
   for(int i = 0; i < ArraySize(values); i++)
   {
      MqlCalendarEvent ev;
      if(!CalendarEventById(values[i].event_id, ev)) continue;
      if(ev.importance != CALENDAR_IMPORTANCE_HIGH) continue;
      int k = ArraySize(g_calNews);
      ArrayResize(g_calNews, k + 1);
      g_calNews[k] = values[i].time - offset * 3600; // サーバー時刻 → GMT
   }
}

// 次/直近の指標までの分数判定
bool NewsWindow(int beforeMin, int afterMin)
{
   datetime now = NowGMT();
   for(int i = 0; i < ArraySize(g_manualNews); i++)
      if(now >= g_manualNews[i] - beforeMin * 60 && now <= g_manualNews[i] + afterMin * 60) return true;
   for(int i = 0; i < ArraySize(g_calNews); i++)
      if(now >= g_calNews[i] - beforeMin * 60 && now <= g_calNews[i] + afterMin * 60) return true;
   return false;
}

//==================== Daily stats ====================
void UpdateDailyStats()
{
   MqlDateTime d; TimeToStruct(TimeCurrent(), d);
   d.hour = 0; d.min = 0; d.sec = 0;
   datetime start = StructToTime(d);

   g_dayPnL = 0.0; g_dayTrades = 0; g_consecLoss = 0; g_lastLossTime = 0;
   if(!HistorySelect(start, TimeCurrent() + 60)) return;

   int n = HistoryDealsTotal();
   for(int i = 0; i < n; i++)
   {
      ulong tk = HistoryDealGetTicket(i);
      if(tk == 0) continue;
      if(HistoryDealGetInteger(tk, DEAL_MAGIC) != InpMagic) continue;
      if(HistoryDealGetString(tk, DEAL_SYMBOL) != _Symbol) continue;
      long entry = HistoryDealGetInteger(tk, DEAL_ENTRY);
      if(entry == DEAL_ENTRY_IN) { g_dayTrades++; continue; }
      if(entry == DEAL_ENTRY_OUT || entry == DEAL_ENTRY_OUT_BY || entry == DEAL_ENTRY_INOUT)
      {
         double pnl = HistoryDealGetDouble(tk, DEAL_PROFIT)
                    + HistoryDealGetDouble(tk, DEAL_SWAP)
                    + HistoryDealGetDouble(tk, DEAL_COMMISSION);
         g_dayPnL += pnl;
         if(pnl < 0) { g_consecLoss++; g_lastLossTime = (datetime)HistoryDealGetInteger(tk, DEAL_TIME); }
         else if(pnl > 0) g_consecLoss = 0;
      }
   }

   if(start != g_dayStart)
   {
      g_dayStart    = start;
      g_dayStartBal = AccountInfoDouble(ACCOUNT_BALANCE) - g_dayPnL;
   }
}

bool DailyLimitHit(string &why)
{
   double base = (g_dayStartBal > 0) ? g_dayStartBal : AccountInfoDouble(ACCOUNT_BALANCE);
   double floating = AccountInfoDouble(ACCOUNT_EQUITY) - AccountInfoDouble(ACCOUNT_BALANCE);
   double total = g_dayPnL + floating;
   if(InpDailyLossPct > 0 && total <= -base * InpDailyLossPct / 100.0) { why = "日次損失上限"; return true; }
   if(InpDailyProfitPct > 0 && g_dayPnL >= base * InpDailyProfitPct / 100.0) { why = "日次利益目標達成"; return true; }
   if(g_dayTrades >= InpMaxTradesDay) { why = "本日の最大回数"; return true; }
   if(g_consecLoss >= InpMaxConsecLoss) { why = "連敗停止"; return true; }
   return false;
}

//==================== Positions ====================
int CountMyPositions()
{
   int c = 0;
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      c++;
   }
   return c;
}

void CloseAll(string reason)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      if(!trade.PositionClose(tk))
         PrintFormat("[%s] Close失敗 #%I64u (%s) ret=%u", InpEAName, tk, reason, trade.ResultRetcode());
      else
         PrintFormat("[%s] 決済 #%I64u 理由=%s", InpEAName, tk, reason);
   }
}

// コメントに初期R(points)を埋め込む:  "BLZ|SW|350"
double ParseRPoints(string cmt)
{
   string p[];
   if(StringSplit(cmt, '|', p) >= 3 && p[0] == "BLZ") return StringToDouble(p[2]);
   return 0.0;
}

double NormalizeVol(double v)
{
   double step = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double vmax = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX);
   if(step <= 0) step = 0.01;
   v = MathFloor(v / step + 1e-9) * step;
   v = MathMin(v, MathMin(vmax, InpMaxLot));
   if(v < vmin) return 0.0;
   return NormalizeDouble(v, 2);
}

double CalcLots(double slDist, double riskMult)
{
   double riskMoney = AccountInfoDouble(ACCOUNT_EQUITY) * InpRiskPct / 100.0 * riskMult;
   double tickVal   = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE_LOSS);
   if(tickVal <= 0) tickVal = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
   double tickSize  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   if(tickVal <= 0 || tickSize <= 0 || slDist <= 0) return 0.0;

   double lossPerLot = slDist / tickSize * tickVal;
   double raw  = riskMoney / lossPerLot;
   double vmin = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
   double lots = NormalizeVol(raw);
   // 最小ロットでもリスクが想定の1.5倍を超えるなら見送り
   if(lots <= 0.0)
   {
      if(vmin * lossPerLot <= riskMoney * 1.5) lots = vmin;
      else return 0.0;
   }
   return lots;
}

//==================== Signal ====================
struct Signal
{
   int    dir;       // +1 buy, -1 sell, 0 none
   string tag;       // "SW" / "PB"
   double sl;        // SL価格
   double riskMult;  // リスク倍率
};

// 前日高安がまだ今日取られていないか（取られていない=流動性が残っている）
void GetFreshPDHL(const MqlRates &r[], int barsToday, double &pdh, double &pdl)
{
   pdh = 0.0; pdl = 0.0;
   double H = iHigh(_Symbol, PERIOD_D1, 1);
   double L = iLow(_Symbol, PERIOD_D1, 1);
   if(H <= 0 || L <= 0) return;
   double hi = -DBL_MAX, lo = DBL_MAX;
   int lim = MathMin(barsToday, ArraySize(r) - 1);
   for(int i = 2; i <= lim; i++) { hi = MathMax(hi, r[i].high); lo = MathMin(lo, r[i].low); }
   if(lim < 2 || hi < H) pdh = H;
   if(lim < 2 || lo > L) pdl = L;
}

// 未タッチのスイング高値（最低 InpSweepMinAge 本前に作られ、以降更新されていない）
double FindRestingHigh(const MqlRates &r[])
{
   double lvl = -DBL_MAX; int idx = -1;
   for(int i = 2; i <= InpSweepLookback + 1; i++)
      if(r[i].high > lvl) { lvl = r[i].high; idx = i; }
   if(idx < 1 + InpSweepMinAge) return 0.0;
   return lvl;
}

double FindRestingLow(const MqlRates &r[])
{
   double lvl = DBL_MAX; int idx = -1;
   for(int i = 2; i <= InpSweepLookback + 1; i++)
      if(r[i].low < lvl) { lvl = r[i].low; idx = i; }
   if(idx < 1 + InpSweepMinAge) return 0.0;
   return lvl;
}

bool CheckSweep(const MqlRates &r[], double atr, int barsToday, Signal &sig)
{
   if(!InpUseSweep) return false;
   MqlRates b = r[1];
   double range = b.high - b.low;
   if(range < InpSweepMinRange * atr || range <= 0) return false;

   double pdh = 0, pdl = 0;
   if(InpSweepUsePDHL) GetFreshPDHL(r, barsToday, pdh, pdl);

   double spread = Ask() - Bid();

   //--- 売り: 高値側の流動性を狩って戻した
   double lvls[2]; lvls[0] = FindRestingHigh(r); lvls[1] = pdh;
   for(int k = 0; k < 2; k++)
   {
      double lvl = lvls[k];
      if(lvl <= 0) continue;
      double pierce = b.high - lvl;
      double upWick = b.high - MathMax(b.open, b.close);
      if(pierce < InpSweepMinPierce * atr || pierce > InpSweepMaxPierce * atr) continue;
      if(b.close >= lvl) continue;
      if(upWick < InpSweepWickRatio * range) continue;
      if(b.close > b.low + 0.5 * range) continue;
      if(g_adx >= InpADXStrong && g_biasDir == +1) continue; // 強い上昇トレンドは逆張りしない

      sig.dir = -1; sig.tag = "SW";
      sig.sl  = b.high + InpSweepSLBuf * atr + spread;
      sig.riskMult = (g_biasDir == -1) ? 1.0 : (g_biasDir == 0 ? 0.8 : 0.5);
      if(k == 1) sig.riskMult = MathMin(1.0, sig.riskMult + 0.2); // 前日高値スイープは加点
      return true;
   }

   //--- 買い: 安値側の流動性を狩って戻した
   lvls[0] = FindRestingLow(r); lvls[1] = pdl;
   for(int k = 0; k < 2; k++)
   {
      double lvl = lvls[k];
      if(lvl <= 0) continue;
      double pierce = lvl - b.low;
      double dnWick = MathMin(b.open, b.close) - b.low;
      if(pierce < InpSweepMinPierce * atr || pierce > InpSweepMaxPierce * atr) continue;
      if(b.close <= lvl) continue;
      if(dnWick < InpSweepWickRatio * range) continue;
      if(b.close < b.high - 0.5 * range) continue;
      if(g_adx >= InpADXStrong && g_biasDir == -1) continue;

      sig.dir = +1; sig.tag = "SW";
      sig.sl  = b.low - InpSweepSLBuf * atr;
      sig.riskMult = (g_biasDir == +1) ? 1.0 : (g_biasDir == 0 ? 0.8 : 0.5);
      if(k == 1) sig.riskMult = MathMin(1.0, sig.riskMult + 0.2);
      return true;
   }
   return false;
}

bool CheckPullback(const MqlRates &r[], double atr, int htfDir, Signal &sig)
{
   if(!InpUsePullback) return false;
   if(g_adx < InpADXTrend || g_biasDir == 0) return false;
   if(InpPBUseHTF && htfDir != g_biasDir) return false;

   double emaF[], emaS[], rsi[];
   if(!GetBuf(hEMAFast, 0, 1, 3, emaF)) return false;
   if(!GetBuf(hEMASlow, 0, 1, 1, emaS)) return false;
   if(!GetBuf(hRSI, 0, 1, 4, rsi)) return false;

   MqlRates b = r[1];
   double range = b.high - b.low;
   if(range <= 0) return false;
   double body = MathAbs(b.close - b.open);

   if(g_biasDir == +1)
   {
      double lowest = MathMin(r[1].low, MathMin(r[2].low, r[3].low));
      bool touched  = (lowest <= emaF[0] + InpPBTouchATR * atr);
      double rsiMin = MathMin(MathMin(rsi[0], rsi[1]), MathMin(rsi[2], rsi[3]));
      if(!touched) return false;
      if(b.close <= emaF[0] || b.close <= emaS[0]) return false;
      if(b.close - emaF[0] > InpPBMaxChaseATR * atr) return false;
      if(rsiMin > InpPBRSIDip) return false;
      if(!(b.close > b.open && body >= 0.4 * range && b.close >= b.high - 0.35 * range)) return false;
      if(b.close <= r[2].high) return false;

      sig.dir = +1; sig.tag = "PB";
      sig.sl  = lowest - InpPBSLBuf * atr;
      sig.riskMult = 1.0;
      return true;
   }
   else
   {
      double highest = MathMax(r[1].high, MathMax(r[2].high, r[3].high));
      bool touched   = (highest >= emaF[0] - InpPBTouchATR * atr);
      double rsiMax  = MathMax(MathMax(rsi[0], rsi[1]), MathMax(rsi[2], rsi[3]));
      if(!touched) return false;
      if(b.close >= emaF[0] || b.close >= emaS[0]) return false;
      if(emaF[0] - b.close > InpPBMaxChaseATR * atr) return false;
      if(rsiMax < 100.0 - InpPBRSIDip) return false;
      if(!(b.close < b.open && body >= 0.4 * range && b.close <= b.low + 0.35 * range)) return false;
      if(b.close >= r[2].low) return false;

      sig.dir = -1; sig.tag = "PB";
      sig.sl  = highest + InpPBSLBuf * atr + (Ask() - Bid());
      sig.riskMult = 1.0;
      return true;
   }
}

//==================== Entry ====================
bool OpenTrade(const Signal &sig, double atr)
{
   double entry = (sig.dir > 0) ? Ask() : Bid();
   double dist  = MathAbs(entry - sig.sl);
   if(dist > InpMaxSLATR * atr) { g_status = "SL幅過大で見送り"; return false; }
   if(dist < InpMinSLATR * atr) dist = InpMinSLATR * atr;

   long stopsLvl = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   if(dist < stopsLvl * Pt()) dist = stopsLvl * Pt() + Pt();

   double sl = (sig.dir > 0) ? entry - dist : entry + dist;
   double tp = (sig.dir > 0) ? entry + InpTP2R * dist : entry - InpTP2R * dist;

   double lots = CalcLots(dist, sig.riskMult);
   if(lots <= 0) { g_status = "ロット計算不可"; return false; }

   double margin = 0.0;
   ENUM_ORDER_TYPE ot = (sig.dir > 0) ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   if(OrderCalcMargin(ot, _Symbol, lots, entry, margin) && margin > AccountInfoDouble(ACCOUNT_MARGIN_FREE) * 0.8)
   { g_status = "証拠金不足"; return false; }

   string cmt = StringFormat("BLZ|%s|%d", sig.tag, (int)MathRound(dist / Pt()));
   bool ok = (sig.dir > 0) ? trade.Buy(lots, _Symbol, 0.0, NP(sl), NP(tp), cmt)
                           : trade.Sell(lots, _Symbol, 0.0, NP(sl), NP(tp), cmt);
   if(ok && (trade.ResultRetcode() == TRADE_RETCODE_DONE || trade.ResultRetcode() == TRADE_RETCODE_PLACED))
   {
      PrintFormat("[%s] %s %s lots=%.2f SL=%.2f TP=%.2f R=%.2f riskMult=%.2f",
                  InpEAName, sig.tag, sig.dir > 0 ? "BUY" : "SELL", lots, sl, tp, dist, sig.riskMult);
      return true;
   }
   PrintFormat("[%s] 発注失敗 ret=%u %s", InpEAName, trade.ResultRetcode(), trade.ResultRetcodeDescription());
   return false;
}

//==================== Management ====================
void ManagePositions(double atr)
{
   double tp1Frac = MathMax(0.0, MathMin(1.0, InpTP1ClosePct / 100.0));
   long   stopsLvl = SymbolInfoInteger(_Symbol, SYMBOL_TRADE_STOPS_LEVEL);
   double minGap = stopsLvl * Pt();

   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;

      long   type  = PositionGetInteger(POSITION_TYPE);
      double open  = PositionGetDouble(POSITION_PRICE_OPEN);
      double sl    = PositionGetDouble(POSITION_SL);
      double tp    = PositionGetDouble(POSITION_TP);
      double vol   = PositionGetDouble(POSITION_VOLUME);
      datetime ot  = (datetime)PositionGetInteger(POSITION_TIME);
      double rPts  = ParseRPoints(PositionGetString(POSITION_COMMENT));
      double R     = (rPts > 0) ? rPts * Pt() : MathAbs(open - sl);
      if(R <= 0) R = atr;

      bool   isBuy = (type == POSITION_TYPE_BUY);
      double px    = isBuy ? Bid() : Ask();
      double profR = isBuy ? (px - open) / R : (open - px) / R;
      bool   secured = isBuy ? (sl >= open) : (sl > 0 && sl <= open); // 建値以上にSL=TP1済み

      int held = iBarShift(_Symbol, InpExecTF, ot, false);
      if(held < 0) held = 0;

      //--- 最大保有 / タイムストップ
      if(held >= InpMaxHoldBars) { trade.PositionClose(tk); PrintFormat("[%s] 最大保有で決済 #%I64u", InpEAName, tk); continue; }
      if(!secured && held >= InpTimeStopBars && profR < InpTimeStopMinR)
      { trade.PositionClose(tk); PrintFormat("[%s] タイムストップ #%I64u R=%.2f", InpEAName, tk, profR); continue; }

      //--- TP1: 建値ロック → 成功したら部分利確（SL移動が先=二重利確防止）
      if(!secured && profR >= InpTP1R)
      {
         double be = isBuy ? open + InpBELockR * R : open - InpBELockR * R;
         if((isBuy && px - be <= minGap) || (!isBuy && be - px <= minGap)) continue;
         if(!trade.PositionModify(tk, NP(be), tp)) continue;
         double closeVol = NormalizeVol(vol * tp1Frac);
         if(closeVol > 0 && closeVol < vol)
            trade.PositionClosePartial(tk, closeVol);
         continue;
      }

      //--- TP1後: ATRトレール
      if(secured && InpTrailATR > 0)
      {
         double nsl = isBuy ? px - InpTrailATR * atr : px + InpTrailATR * atr;
         bool better = isBuy ? (nsl > sl + Pt()) : (nsl < sl - Pt());
         bool valid  = isBuy ? (px - nsl > minGap) : (nsl - px > minGap);
         if(better && valid) trade.PositionModify(tk, NP(nsl), tp);
      }
   }
}

void CloseOpposite(int newDir)
{
   for(int i = PositionsTotal() - 1; i >= 0; i--)
   {
      ulong tk = PositionGetTicket(i);
      if(tk == 0) continue;
      if(PositionGetInteger(POSITION_MAGIC) != InpMagic) continue;
      if(PositionGetString(POSITION_SYMBOL) != _Symbol) continue;
      int dir = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? +1 : -1;
      if(dir != newDir && trade.PositionClose(tk))
         PrintFormat("[%s] 逆シグナルで決済 #%I64u", InpEAName, tk);
   }
}

//==================== HUD ====================
void DrawHUD()
{
   if(!InpShowHUD) return;
   string bias = (g_biasDir > 0) ? "UP" : (g_biasDir < 0 ? "DOWN" : "FLAT");
   string s = StringFormat(
      "%s  [Magic %I64d]\n"
      "GMT %02d:%02d  Session: %s\n"
      "Bias(M15): %s  ADX: %.1f\n"
      "ATR: %.2f  Ratio: %.2f  Spread: %d\n"
      "Today PnL: %.2f  Trades: %d/%d  ConsecLoss: %d\n"
      "Status: %s",
      InpEAName, InpMagic,
      GMTMinuteOfDay() / 60, GMTMinuteOfDay() % 60, InTradingSession() ? "ON" : "OFF",
      bias, g_adx,
      g_atr, g_atrRatio, (int)SymbolInfoInteger(_Symbol, SYMBOL_SPREAD),
      g_dayPnL, g_dayTrades, InpMaxTradesDay, g_consecLoss,
      g_status);
   Comment(s);
}

//==================== Events ====================
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetDeviationInPoints(InpDeviationPts);
   trade.SetTypeFillingBySymbol(_Symbol);

   hATR     = iATR(_Symbol, InpExecTF, InpATRPeriod);
   hATRSlow = iATR(_Symbol, InpExecTF, InpATRSlowPeriod);
   hEMAFast = iMA(_Symbol, InpExecTF, InpPBFastEMA, 0, MODE_EMA, PRICE_CLOSE);
   hEMASlow = iMA(_Symbol, InpExecTF, InpPBSlowEMA, 0, MODE_EMA, PRICE_CLOSE);
   hRSI     = iRSI(_Symbol, InpExecTF, InpRSIPeriod, PRICE_CLOSE);
   hBiasEMA = iMA(_Symbol, InpBiasTF, InpBiasEMA, 0, MODE_EMA, PRICE_CLOSE);
   hADX     = iADX(_Symbol, InpBiasTF, InpADXPeriod);
   hHTFEMA  = iMA(_Symbol, InpHTF, InpHTFEMA, 0, MODE_EMA, PRICE_CLOSE);

   if(hATR == INVALID_HANDLE || hATRSlow == INVALID_HANDLE || hEMAFast == INVALID_HANDLE ||
      hEMASlow == INVALID_HANDLE || hRSI == INVALID_HANDLE || hBiasEMA == INVALID_HANDLE ||
      hADX == INVALID_HANDLE || hHTFEMA == INVALID_HANDLE)
   {
      Print("インジケーターハンドル作成失敗");
      return INIT_FAILED;
   }

   if(StringFind(_Symbol, "XAU") < 0 && StringFind(_Symbol, "GOLD") < 0)
      PrintFormat("[%s] 警告: XAUUSD向けに設計されています (現在 %s)", InpEAName, _Symbol);

   ParseManualNews();
   UpdateDailyStats();
   PrintFormat("[%s] 初期化完了 GMTオフセット=%d", InpEAName, ServerGMTOffsetHours());
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   IndicatorRelease(hATR);     IndicatorRelease(hATRSlow);
   IndicatorRelease(hEMAFast); IndicatorRelease(hEMASlow);
   IndicatorRelease(hRSI);     IndicatorRelease(hBiasEMA);
   IndicatorRelease(hADX);     IndicatorRelease(hHTFEMA);
   Comment("");
}

void OnTick()
{
   double atrArr[];
   if(!GetBuf(hATR, 0, 1, 1, atrArr)) return;
   double atr = atrArr[0];
   if(atr <= 0) return;
   g_atr = atr;

   LoadCalendar();

   //--- 毎ティック: 保有管理と強制決済
   if(CountMyPositions() > 0)
   {
      if(MustFlattenByTime())                         CloseAll("時間切れ(持ち越し禁止)");
      else if(InpNewsFlatten && NewsWindow(5, 0))     CloseAll("指標直前");
      else                                            ManagePositions(atr);
   }

   //--- 新しい執行足でのみシグナル判定
   datetime bt = iTime(_Symbol, InpExecTF, 0);
   if(bt == g_lastBar) { DrawHUD(); return; }
   g_lastBar = bt;

   UpdateDailyStats();
   if(g_spikePause > 0) g_spikePause--;

   // 足データ
   int need = MathMax(InpSweepLookback + 3, 300);
   MqlRates r[];
   ArraySetAsSeries(r, true);
   if(CopyRates(_Symbol, InpExecTF, 0, need, r) < need) { g_status = "データ不足"; DrawHUD(); return; }

   // バイアス
   double be[], adx[], htf[];
   if(!GetBuf(hBiasEMA, 0, 1, 4, be) || !GetBuf(hADX, 0, 1, 1, adx) || !GetBuf(hHTFEMA, 0, 1, 1, htf))
   { g_status = "指標取得待ち"; DrawHUD(); return; }
   double biasClose = iClose(_Symbol, InpBiasTF, 1);
   double htfClose  = iClose(_Symbol, InpHTF, 1);
   g_adx = adx[0];
   g_biasDir = 0;
   if(biasClose > be[0] && be[0] > be[3]) g_biasDir = +1;
   else if(biasClose < be[0] && be[0] < be[3]) g_biasDir = -1;
   int htfDir = (htfClose > htf[0]) ? +1 : -1;

   // 環境フィルター
   double atrS[];
   if(!GetBuf(hATRSlow, 0, 1, 1, atrS) || atrS[0] <= 0) { DrawHUD(); return; }
   g_atrRatio = atr / atrS[0];

   if(r[1].high - r[1].low >= InpSpikeATR * atr) g_spikePause = InpSpikePauseBars;

   // 今日の本数（前日高安の鮮度判定用）
   MqlDateTime d; TimeToStruct(TimeCurrent(), d); d.hour = 0; d.min = 0; d.sec = 0;
   int barsToday = iBarShift(_Symbol, InpExecTF, StructToTime(d), false);
   if(barsToday < 0) barsToday = 0;

   // シグナル計算（逆シグナル決済にも使うので先に算出）
   Signal sig; sig.dir = 0; sig.tag = ""; sig.sl = 0; sig.riskMult = 1.0;
   bool has = false;
   if(g_adx >= InpADXTrend) has = CheckPullback(r, atr, htfDir, sig);   // トレンド局面は押し目優先
   if(!has) has = CheckSweep(r, atr, barsToday, sig);
   if(!has && g_adx < InpADXTrend) has = CheckPullback(r, atr, htfDir, sig);

   if(has && InpCloseOnOpposite && CountMyPositions() > 0) CloseOpposite(sig.dir);

   // エントリー可否
   string why = "";
   if(!InTradingSession())                                       why = "セッション外";
   else if(MustFlattenByTime())                                  why = "強制決済時間帯";
   else if(DailyLimitHit(why))                                   { }
   else if(NewsWindow(InpNewsBeforeMin, InpNewsAfterMin))        why = "指標前後";
   else if(SymbolInfoInteger(_Symbol, SYMBOL_SPREAD) > InpMaxSpreadPts) why = "スプレッド拡大";
   else if(g_atrRatio < InpATRRatioMin)                          why = "ボラ不足";
   else if(g_atrRatio > InpATRRatioMax)                          why = "ボラ過大";
   else if(g_spikePause > 0)                                     why = "スパイク後待機";
   else if(g_lastLossTime > 0 && iBarShift(_Symbol, InpExecTF, g_lastLossTime, false) < InpCooldownBars) why = "負け後クールダウン";
   else if(CountMyPositions() > 0)                               why = "保有中";

   if(why != "") { g_status = why; DrawHUD(); return; }

   if(has)
   {
      if(OpenTrade(sig, atr)) g_status = StringFormat("エントリー %s %s", sig.tag, sig.dir > 0 ? "BUY" : "SELL");
   }
   else g_status = "監視中";

   DrawHUD();
}
//+------------------------------------------------------------------+
