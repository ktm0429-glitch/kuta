//+------------------------------------------------------------------+
//| JevNewsFilter_Demo.mq5                                           |
//| Shows the Jev news judgement on the chart. Does NOT trade.       |
//| Use it on a demo account first to check the filter's behaviour.  |
//+------------------------------------------------------------------+
#property strict
#include <Jev/JevNewsFilter.mqh>

input string             InpJevApiKey   = "";                 // Jev API key (do not share presets)
input int                InpMinBefore   = 30;                 // Window: minutes before event
input int                InpMinAfter    = 30;                 // Window: minutes after event
input ENUM_CALENDAR_EVENT_IMPORTANCE InpMinImportance = CALENDAR_IMPORTANCE_HIGH; // Minimum importance
input double             InpThreshold   = 0.50;               // Block when P(avoid) >= this
input ENUM_JEV_FAIL_MODE InpFailMode    = JEV_FAIL_BLOCK;     // On API/calendar error

CJevNewsFilter g_news;
datetime       g_lastCheck = 0;

int OnInit()
  {
   g_news.Init(InpJevApiKey, InpMinBefore, InpMinAfter, (int)InpMinImportance, InpThreshold, InpFailMode);
   Print("JevNewsFilter_Demo initialized.");
   return(INIT_SUCCEEDED);
  }

void OnTick()
  {
   if(TimeCurrent() - g_lastCheck < 10)   // judge at most every 10 s
      return;
   g_lastCheck = TimeCurrent();

   string why;
   bool ok = g_news.Allow(_Symbol, why);
   Comment("Jev news filter\n",
           "Entry: ", ok ? "ALLOWED" : "BLOCKED", "\n",
           why, "\n",
           "P(avoid)=", DoubleToString(g_news.LastAvoidProb(), 2),
           "  P(up)=", DoubleToString(g_news.LastUpProb(), 2),
           "  P(down)=", DoubleToString(g_news.LastDownProb(), 2));
  }

void OnDeinit(const int reason)
  {
   Comment("");
  }
