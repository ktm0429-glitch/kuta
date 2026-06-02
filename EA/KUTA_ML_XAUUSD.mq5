//+------------------------------------------------------------------+
//|  KUTA ML XAUUSD EA                                               |
//|  全自動機械学習トレーディングシステム — XAUUSD H1専用            |
//|  Python MLサーバー (localhost:5000) と連携して売買シグナルを取得  |
//+------------------------------------------------------------------+
#property copyright "KUTA"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>
#include <Trade\PositionInfo.mqh>

//--- 入力パラメーター
input group "=== リスク管理 ==="
input double InpLotSize        = 0.1;    // ロットサイズ
input double InpMaxLots        = 1.0;    // 最大ロット
input double InpRiskPercent    = 1.0;    // リスク割合(%)
input double InpStopLossPips   = 200;    // ストップロス (pips)
input double InpTakeProfitPips = 400;    // テイクプロフィット (pips)
input bool   InpUseATRSL       = true;   // ATRベースのSL/TP使用
input double InpATRMultSL      = 1.5;    // ATR倍率 (SL)
input double InpATRMultTP      = 3.0;    // ATR倍率 (TP)

input group "=== ML設定 ==="
input string InpServerURL      = "http://127.0.0.1:5000";  // MLサーバーURL
input double InpSignalThresh   = 0.60;   // シグナル閾値 (0.50-0.95)
input int    InpBarsToSend     = 250;    // サーバーに送るバー数
input int    InpCheckEvery     = 60;     // シグナル確認間隔(秒)

input group "=== フィルター ==="
input int    InpSpreadMaxPips  = 30;     // 最大スプレッド (pips)
input bool   InpTradeNYSession = true;   // NYセッション (14-22 UTC)
input bool   InpTradeLDSession = true;   // ロンドンセッション (8-16 UTC)
input bool   InpTradeAsiaSession = false;// アジアセッション
input int    InpMaxOpenTrades  = 1;      // 最大同時ポジション数

input group "=== データ出力 ==="
input bool   InpExportOHLCV    = true;   // OHLCVをCSV出力する
input string InpDataPath       = "KUTA_ML\\data\\ohlcv_H1.csv"; // 出力先

//--- グローバル変数
CTrade         Trade;
CPositionInfo  PosInfo;

datetime g_last_check    = 0;
datetime g_last_export   = 0;
int      g_export_handle = INVALID_HANDLE;
double   g_point;
int      g_digits;
bool     g_server_ok     = false;

//+------------------------------------------------------------------+
int OnInit()
{
    if(_Symbol != "XAUUSD") {
        Alert("このEAはXAUUSD専用です。");
        return INIT_FAILED;
    }

    g_point  = _Point;
    g_digits = _Digits;

    Trade.SetExpertMagicNumber(20240101);
    Trade.SetDeviationInPoints(30);
    Trade.SetTypeFilling(ORDER_FILLING_IOC);

    // サーバー疎通確認
    g_server_ok = CheckServerHealth();
    if(!g_server_ok) {
        Print("⚠️ MLサーバーに接続できません。起動後に自動リトライします。");
    }

    // OHLCV出力ファイルを開く
    if(InpExportOHLCV) {
        OpenExportFile();
    }

    EventSetTimer(InpCheckEvery);
    Print("✅ KUTA ML EA 起動完了");
    return INIT_SUCCEEDED;
}

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
    EventKillTimer();
    if(g_export_handle != INVALID_HANDLE) {
        FileClose(g_export_handle);
        g_export_handle = INVALID_HANDLE;
    }
}

//+------------------------------------------------------------------+
void OnTimer()
{
    if(InpExportOHLCV) ExportOHLCV();

    if(!IsTradeAllowed()) return;
    if(!IsSessionAllowed()) return;
    if(!CheckSpread()) return;
    if(CountOpenPositions() >= InpMaxOpenTrades) return;

    // サーバー再接続試行
    if(!g_server_ok) {
        g_server_ok = CheckServerHealth();
        if(!g_server_ok) return;
    }

    string signal = "";
    double prob_buy = 0, prob_sell = 0;

    if(!GetMLSignal(signal, prob_buy, prob_sell)) return;

    if(signal == "BUY") {
        OpenBuy(prob_buy);
    } else if(signal == "SELL") {
        OpenSell(prob_sell);
    }
}

//+------------------------------------------------------------------+
void OnTick() {}  // タイマー駆動のためティック処理不要

//+------------------------------------------------------------------+
void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest&     req,
                        const MqlTradeResult&      res)
{
    // ポジションクローズ時に損益をサーバーに報告
    if(trans.type == TRADE_TRANSACTION_DEAL_ADD) {
        ulong ticket = trans.deal;
        if(HistoryDealSelect(ticket)) {
            long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
            if(entry == DEAL_ENTRY_OUT) {
                ReportClosedTrade(ticket);
            }
        }
    }
}

//+------------------------------------------------------------------+
bool GetMLSignal(string &signal, double &prob_buy, double &prob_sell)
{
    // バーデータをJSON配列に変換
    string json = BuildBarsJSON(InpBarsToSend);
    if(json == "") return false;

    string url = InpServerURL + "/predict?threshold=" + DoubleToString(InpSignalThresh, 2);
    string response = HttpPost(url, json);
    if(response == "") return false;

    // JSON解析 (軽量パーサー)
    signal    = ExtractJsonString(response, "signal");
    prob_buy  = ExtractJsonDouble(response, "prob_buy");
    prob_sell = ExtractJsonDouble(response, "prob_sell");

    PrintFormat("ML Signal: %s  BUY=%.2f  SELL=%.2f", signal, prob_buy, prob_sell);
    return (signal != "");
}

//+------------------------------------------------------------------+
string BuildBarsJSON(int count)
{
    MqlRates rates[];
    int copied = CopyRates(_Symbol, PERIOD_H1, 0, count, rates);
    if(copied <= 0) {
        Print("バーデータ取得失敗");
        return "";
    }

    string json = "[";
    for(int i = 0; i < copied; i++) {
        if(i > 0) json += ",";
        json += StringFormat(
            "{\"time\":\"%s\",\"open\":%.5f,\"high\":%.5f,\"low\":%.5f,\"close\":%.5f,\"tick_volume\":%d}",
            TimeToString(rates[i].time, TIME_DATE|TIME_MINUTES),
            rates[i].open, rates[i].high, rates[i].low, rates[i].close,
            (int)rates[i].tick_volume
        );
    }
    json += "]";
    return json;
}

//+------------------------------------------------------------------+
void OpenBuy(double prob)
{
    double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
    double sl  = 0, tp = 0;
    CalcSLTP(ask, ORDER_TYPE_BUY, sl, tp);

    double lots = CalcLots(ask - sl);
    if(lots <= 0) return;

    if(Trade.Buy(lots, _Symbol, ask, sl, tp, StringFormat("KUTA ML BUY p=%.2f", prob))) {
        PrintFormat("✅ BUY 実行 lots=%.2f ask=%.2f SL=%.2f TP=%.2f", lots, ask, sl, tp);
    }
}

//+------------------------------------------------------------------+
void OpenSell(double prob)
{
    double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
    double sl  = 0, tp = 0;
    CalcSLTP(bid, ORDER_TYPE_SELL, sl, tp);

    double lots = CalcLots(sl - bid);
    if(lots <= 0) return;

    if(Trade.Sell(lots, _Symbol, bid, sl, tp, StringFormat("KUTA ML SELL p=%.2f", prob))) {
        PrintFormat("✅ SELL 実行 lots=%.2f bid=%.2f SL=%.2f TP=%.2f", lots, bid, sl, tp);
    }
}

//+------------------------------------------------------------------+
void CalcSLTP(double price, ENUM_ORDER_TYPE type, double &sl, double &tp)
{
    double sl_dist, tp_dist;

    if(InpUseATRSL) {
        double atr[];
        if(CopyBuffer(iATR(_Symbol, PERIOD_H1, 14), 0, 0, 1, atr) <= 0) {
            sl_dist = InpStopLossPips * g_point * 10;
            tp_dist = InpTakeProfitPips * g_point * 10;
        } else {
            sl_dist = atr[0] * InpATRMultSL;
            tp_dist = atr[0] * InpATRMultTP;
        }
    } else {
        sl_dist = InpStopLossPips * g_point * 10;
        tp_dist = InpTakeProfitPips * g_point * 10;
    }

    if(type == ORDER_TYPE_BUY) {
        sl = price - sl_dist;
        tp = price + tp_dist;
    } else {
        sl = price + sl_dist;
        tp = price - tp_dist;
    }

    sl = NormalizeDouble(sl, g_digits);
    tp = NormalizeDouble(tp, g_digits);
}

//+------------------------------------------------------------------+
double CalcLots(double sl_dist_price)
{
    if(!InpRiskPercent || sl_dist_price <= 0) return InpLotSize;

    double balance    = AccountInfoDouble(ACCOUNT_BALANCE);
    double risk_money = balance * InpRiskPercent / 100.0;
    double tick_val   = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_VALUE);
    double tick_size  = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
    double lot_step   = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
    double min_lot    = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN);
    double max_lot    = MathMin(SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX), InpMaxLots);

    if(tick_val <= 0 || tick_size <= 0) return InpLotSize;

    double lots = risk_money / (sl_dist_price / tick_size * tick_val);
    lots = MathFloor(lots / lot_step) * lot_step;
    lots = MathMax(min_lot, MathMin(max_lot, lots));

    return NormalizeDouble(lots, 2);
}

//+------------------------------------------------------------------+
int CountOpenPositions()
{
    int count = 0;
    for(int i = 0; i < PositionsTotal(); i++) {
        if(PosInfo.SelectByIndex(i) && PosInfo.Symbol() == _Symbol &&
           PosInfo.Magic() == 20240101) {
            count++;
        }
    }
    return count;
}

//+------------------------------------------------------------------+
bool CheckSpread()
{
    long spread = SymbolInfoInteger(_Symbol, SYMBOL_SPREAD);
    if(spread > InpSpreadMaxPips) {
        PrintFormat("スプレッド過大: %d > %d pips", spread, InpSpreadMaxPips);
        return false;
    }
    return true;
}

//+------------------------------------------------------------------+
bool IsSessionAllowed()
{
    datetime now = TimeGMT();
    MqlDateTime dt;
    TimeToStruct(now, dt);
    int hour = dt.hour;

    bool ny   = (hour >= 14 && hour < 22);
    bool ld   = (hour >=  8 && hour < 16);
    bool asia = (hour >=  0 && hour <  8);

    if(InpTradeNYSession   && ny)   return true;
    if(InpTradeLDSession   && ld)   return true;
    if(InpTradeAsiaSession && asia) return true;

    return false;
}

//+------------------------------------------------------------------+
bool CheckServerHealth()
{
    string response = HttpGet(InpServerURL + "/health");
    return StringFind(response, "\"status\": \"ok\"") >= 0 ||
           StringFind(response, "\"status\":\"ok\"") >= 0;
}

//+------------------------------------------------------------------+
void ReportClosedTrade(ulong ticket)
{
    string symbol    = HistoryDealGetString(ticket, DEAL_SYMBOL);
    double profit    = HistoryDealGetDouble(ticket, DEAL_PROFIT);
    double lots      = HistoryDealGetDouble(ticket, DEAL_VOLUME);
    double price_in  = HistoryDealGetDouble(ticket, DEAL_PRICE);
    datetime time_cl = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
    long dir         = HistoryDealGetInteger(ticket, DEAL_TYPE);

    string json = StringFormat(
        "{\"symbol\":\"%s\",\"direction\":\"%s\","
        "\"close_price\":%.5f,\"lots\":%.2f,"
        "\"close_time\":\"%s\",\"profit\":%.2f}",
        symbol,
        dir == DEAL_TYPE_BUY ? "BUY" : "SELL",
        price_in, lots,
        TimeToString(time_cl, TIME_DATE|TIME_MINUTES),
        profit
    );

    HttpPost(InpServerURL + "/report_trade", json);
    PrintFormat("📊 取引報告: profit=%.2f", profit);
}

//+------------------------------------------------------------------+
void ExportOHLCV()
{
    if(g_export_handle == INVALID_HANDLE) return;

    datetime last_bar = iTime(_Symbol, PERIOD_H1, 0);
    if(last_bar == g_last_export) return;
    g_last_export = last_bar;

    MqlRates r[];
    if(CopyRates(_Symbol, PERIOD_H1, 0, 1, r) <= 0) return;

    string line = StringFormat("%s,%.5f,%.5f,%.5f,%.5f,%d\n",
        TimeToString(r[0].time, TIME_DATE|TIME_MINUTES),
        r[0].open, r[0].high, r[0].low, r[0].close, (int)r[0].tick_volume);

    FileWriteString(g_export_handle, line);
    FileFlush(g_export_handle);
}

//+------------------------------------------------------------------+
void OpenExportFile()
{
    // MT5のMQL5/Files配下に保存
    g_export_handle = FileOpen(InpDataPath, FILE_WRITE|FILE_READ|FILE_CSV|FILE_SHARE_READ|FILE_ANSI);
    if(g_export_handle == INVALID_HANDLE) {
        Print("CSV出力ファイルを開けません: ", InpDataPath, " エラー: ", GetLastError());
        return;
    }

    // ファイルが空ならヘッダーを書く
    if(FileTell(g_export_handle) == 0) {
        FileWriteString(g_export_handle, "time,open,high,low,close,tick_volume\n");
    }

    // 末尾に移動して追記モードへ
    FileSeek(g_export_handle, 0, SEEK_END);

    // 過去データを初回書き出し
    MqlRates hist[];
    int copied = CopyRates(_Symbol, PERIOD_H1, 0, 2000, hist);
    for(int i = copied - 1; i >= 0; i--) {
        string line = StringFormat("%s,%.5f,%.5f,%.5f,%.5f,%d\n",
            TimeToString(hist[i].time, TIME_DATE|TIME_MINUTES),
            hist[i].open, hist[i].high, hist[i].low, hist[i].close,
            (int)hist[i].tick_volume);
        FileWriteString(g_export_handle, line);
    }
    FileFlush(g_export_handle);
    Print("OHLCV初期データ書き出し完了: ", copied, "バー");
}

//+------------------------------------------------------------------+
// HTTP ユーティリティ (WinHTTP経由)
//+------------------------------------------------------------------+
string HttpPost(string url, string body)
{
    char post[], result[];
    string headers = "Content-Type: application/json\r\n";
    StringToCharArray(body, post, 0, StringLen(body));
    int timeout = 5000;
    int res = WebRequest("POST", url, headers, timeout, post, result, headers);
    if(res == -1) {
        PrintFormat("HTTP POSTエラー: %d url=%s", GetLastError(), url);
        return "";
    }
    return CharArrayToString(result);
}

string HttpGet(string url)
{
    char post[], result[];
    string headers = "";
    int timeout = 3000;
    int res = WebRequest("GET", url, headers, timeout, post, result, headers);
    if(res == -1) return "";
    return CharArrayToString(result);
}

//+------------------------------------------------------------------+
// JSON 軽量パーサー
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key)
{
    string search = "\"" + key + "\":\"";
    int pos = StringFind(json, search);
    if(pos < 0) return "";
    pos += StringLen(search);
    int end = StringFind(json, "\"", pos);
    if(end < 0) return "";
    return StringSubstr(json, pos, end - pos);
}

double ExtractJsonDouble(string json, string key)
{
    string search = "\"" + key + "\":";
    int pos = StringFind(json, search);
    if(pos < 0) return 0;
    pos += StringLen(search);
    int end = StringFind(json, ",", pos);
    int end2 = StringFind(json, "}", pos);
    if(end < 0 || (end2 > 0 && end2 < end)) end = end2;
    if(end < 0) return 0;
    return StringToDouble(StringSubstr(json, pos, end - pos));
}
//+------------------------------------------------------------------+
