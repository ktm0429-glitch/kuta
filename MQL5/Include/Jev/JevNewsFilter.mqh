//+------------------------------------------------------------------+
//| JevNewsFilter.mqh                                                |
//| Economic-calendar news filter judged by Jev (TypeSafe AI).       |
//|                                                                  |
//| Usage in an EA:                                                  |
//|   #include <Jev/JevNewsFilter.mqh>                               |
//|   CJevNewsFilter g_news;                                         |
//|   OnInit : g_news.Init(InpJevApiKey);                            |
//|   OnTick : string why;                                           |
//|            if(!g_news.Allow(_Symbol, why)) return;  // no entry  |
//|                                                                  |
//| Terminal setup (required, once):                                 |
//|   Tools > Options > Expert Advisors > "Allow WebRequest for      |
//|   listed URL" > add  https://api.typesafe.ai                     |
//+------------------------------------------------------------------+
#property strict

#ifndef JEV_NEWS_FILTER_MQH
#define JEV_NEWS_FILTER_MQH

enum ENUM_JEV_FAIL_MODE
  {
   JEV_FAIL_BLOCK = 0,   // API/calendar error: block entries if an event is in the window
   JEV_FAIL_ALLOW = 1    // API/calendar error: allow entries
  };

class CJevNewsFilter
  {
private:
   string            m_key;
   string            m_url;
   string            m_model;
   int               m_before;      // minutes before an event that count as "in window"
   int               m_after;       // minutes after an event that count as "in window"
   int               m_timeout;     // WebRequest timeout [ms]
   int               m_retrySec;    // wait before retrying after a failure
   int               m_minImp;      // minimum importance (1=low,2=moderate,3=high)
   double            m_threshold;   // block when P(avoid_trading) >= threshold
   ENUM_JEV_FAIL_MODE m_fail;

   string            m_lastSig;     // signature of the event set last judged
   bool              m_lastBlock;
   string            m_lastReason;
   double            m_pAvoid, m_pUp, m_pDown;
   datetime          m_nextTry;

   //--- helpers --------------------------------------------------------
   static string     JsonEscape(string s)
     {
      StringReplace(s, "\\", "\\\\");
      StringReplace(s, "\"", "\\\"");
      StringReplace(s, "\r", " ");
      StringReplace(s, "\n", "\\n");
      StringReplace(s, "\t", " ");
      return s;
     }

   //--- read the number after  "<key>": ... "noul": <number>
   static bool       ExtractNoul(const string json, const string key, double &value)
     {
      int p = StringFind(json, "\"" + key + "\"");
      if(p < 0)
         return false;
      int pos = p + StringLen(key) + 2;
      int n   = StringLen(json);
      while(true)
        {
         int q = StringFind(json, "\"noul\"", pos);
         if(q < 0)
            return false;
         int i = q + 6;
         while(i < n && (StringGetCharacter(json, i) == ' ' || StringGetCharacter(json, i) == '\t'))
            i++;
         if(i < n && StringGetCharacter(json, i) == ':')   // key "noul": (not the "type":"noul" value)
           {
            i++;
            while(i < n && StringGetCharacter(json, i) == ' ')
               i++;
            int j = i;
            while(j < n)
              {
               ushort c = StringGetCharacter(json, j);
               if((c >= '0' && c <= '9') || c == '.' || c == '-' || c == '+' || c == 'e' || c == 'E')
                  j++;
               else
                  break;
              }
            if(j == i)
               return false;
            value = StringToDouble(StringSubstr(json, i, j - i));
            return true;
           }
         pos = q + 6;
        }
     }

   static string     ImportanceLabel(const int imp)
     {
      switch(imp)
        {
         case CALENDAR_IMPORTANCE_HIGH:     return "HIGH";
         case CALENDAR_IMPORTANCE_MODERATE: return "MEDIUM";
         case CALENDAR_IMPORTANCE_LOW:      return "LOW";
        }
      return "NONE";
     }

   static string     QuestionJson(const string name, const string instr, const string yes, const string no)
     {
      return "\"" + name + "\":{\"type\":\"noul\",\"instructions\":\"" + JsonEscape(instr) + "\","
             "\"criteria\":{\"true\":\"" + JsonEscape(yes) + "\",\"false\":\"" + JsonEscape(no) + "\"}}";
     }

   //--- collect events in the window; returns count, fills text + signature
   int               CollectEvents(const string symbol, const datetime now, string &text, string &sig, bool &dataOk)
     {
      text   = "";
      sig    = "";
      dataOk = true;

      string cur[2];
      cur[0] = SymbolInfoString(symbol, SYMBOL_CURRENCY_PROFIT);
      cur[1] = SymbolInfoString(symbol, SYMBOL_CURRENCY_BASE);
      int nCur = (cur[1] == cur[0] || cur[1] == "") ? 1 : 2;

      int count = 0;
      for(int c = 0; c < nCur; c++)
        {
         MqlCalendarValue values[];
         ResetLastError();
         if(!CalendarValueHistory(values, now - m_after * 60, now + m_before * 60, NULL, cur[c]))
           {
            if(GetLastError() != 0)
               dataOk = false;
            continue;
           }
         for(int i = 0; i < ArraySize(values); i++)
           {
            MqlCalendarEvent ev;
            if(!CalendarEventById(values[i].event_id, ev))
               continue;
            if(ev.type == CALENDAR_TYPE_HOLIDAY || (int)ev.importance < m_minImp)
               continue;

            int    diffMin = (int)((values[i].time - now) / 60);
            string when    = (diffMin >= 0) ? StringFormat("in %d min", diffMin)
                                            : StringFormat("%d min ago", -diffMin);
            string fc = values[i].HasForecastValue() ? DoubleToString(values[i].GetForecastValue(), 3) : "n/a";
            string pv = values[i].HasPreviousValue() ? DoubleToString(values[i].GetPreviousValue(), 3) : "n/a";
            string ac = values[i].HasActualValue()   ? DoubleToString(values[i].GetActualValue(), 3)   : "not released";

            text += StringFormat("[%s] %s %s | %s | forecast=%s previous=%s actual=%s\n",
                                 ImportanceLabel((int)ev.importance), cur[c], ev.name, when, fc, pv, ac);
            sig  += StringFormat("%I64u:%s;", values[i].id, ac);
            count++;
           }
        }
      return count;
     }

   //--- one Jev call; false on transport/parse failure
   bool              AskJev(const string symbol, const string eventsText)
     {
      string state = "Instrument: " + symbol + "\nServer time: " + TimeToString(TimeTradeServer(), TIME_DATE | TIME_MINUTES) +
                     "\nEconomic calendar events near the current time:\n" + eventsText;

      string q = QuestionJson("avoid_trading",
                              "You are the risk filter of an automated trading system for " + symbol + ". "
                              "Given these economic events, is it too risky to open NEW positions right now "
                              "(event-driven spike, spread widening, or unclear direction)?",
                              "Open positions should be avoided now",
                              "Normal trading conditions are acceptable") + ",";
      q += QuestionJson("up",
                        "Do these events, as released or expected, favour a rise in " + symbol + "?",
                        "Likely bullish for " + symbol, "Not clearly bullish") + ",";
      q += QuestionJson("down",
                        "Do these events, as released or expected, favour a fall in " + symbol + "?",
                        "Likely bearish for " + symbol, "Not clearly bearish");

      string body = "{\"model\":\"" + m_model + "\",\"state\":\"" + JsonEscape(state) + "\",\"questions\":{" + q + "}}";

      uchar data[], result[];
      int sz = StringToCharArray(body, data, 0, WHOLE_ARRAY, CP_UTF8);
      if(sz > 0)
         ArrayResize(data, sz - 1);   // drop the terminating zero

      string headers = "Content-Type: application/json\r\nAuthorization: Bearer " + m_key + "\r\n";
      string resHeaders;
      ResetLastError();
      int code = WebRequest("POST", m_url, headers, m_timeout, data, result, resHeaders);
      if(code == -1)
        {
         PrintFormat("JevNewsFilter: WebRequest failed (err=%d). Is %s in the allowed URL list?", GetLastError(), m_url);
         return false;
        }
      string json = CharArrayToString(result, 0, WHOLE_ARRAY, CP_UTF8);
      if(code != 200)
        {
         PrintFormat("JevNewsFilter: HTTP %d  %s", code, StringSubstr(json, 0, 200));
         return false;
        }
      if(!ExtractNoul(json, "avoid_trading", m_pAvoid))
        {
         Print("JevNewsFilter: could not parse response: ", StringSubstr(json, 0, 200));
         return false;
        }
      if(!ExtractNoul(json, "up", m_pUp))
         m_pUp = -1;
      if(!ExtractNoul(json, "down", m_pDown))
         m_pDown = -1;
      return true;
     }

public:
                     CJevNewsFilter()
     {
      m_url = "https://api.typesafe.ai/v1/systemone";
      m_model = "jev-latest";
      m_before = 30;
      m_after = 30;
      m_timeout = 5000;
      m_retrySec = 60;
      m_minImp = CALENDAR_IMPORTANCE_HIGH;
      m_threshold = 0.5;
      m_fail = JEV_FAIL_BLOCK;
      m_lastSig = "";
      m_lastBlock = false;
      m_lastReason = "";
      m_pAvoid = m_pUp = m_pDown = -1;
      m_nextTry = 0;
     }

   void              Init(const string apiKey,
                          const int minutesBefore = 30,
                          const int minutesAfter = 30,
                          const int minImportance = CALENDAR_IMPORTANCE_HIGH,
                          const double blockThreshold = 0.5,
                          const ENUM_JEV_FAIL_MODE failMode = JEV_FAIL_BLOCK,
                          const int timeoutMs = 5000)
     {
      m_key = apiKey;
      m_before = MathMax(0, minutesBefore);
      m_after = MathMax(0, minutesAfter);
      m_minImp = minImportance;
      m_threshold = blockThreshold;
      m_fail = failMode;
      m_timeout = timeoutMs;
      if(m_key == "")
         Print("JevNewsFilter: API key is empty. Fail mode will be used.");
     }

   double            LastAvoidProb() const { return m_pAvoid; }
   double            LastUpProb()    const { return m_pUp; }     // informational (-1 = n/a)
   double            LastDownProb()  const { return m_pDown; }   // informational (-1 = n/a)

   //--- true = entries allowed. "reason" explains the decision.
   bool              Allow(const string symbol, string &reason)
     {
      //--- the economic calendar is unavailable in the Strategy Tester
      if(MQLInfoInteger(MQL_TESTER))
        {
         reason = "tester: news filter inactive (calendar unavailable)";
         return true;
        }

      datetime now = TimeTradeServer();
      string text, sig;
      bool dataOk;
      int n = CollectEvents(symbol, now, text, sig, dataOk);

      if(!dataOk)
        {
         reason = "calendar error";
         return (m_fail == JEV_FAIL_ALLOW);
        }
      if(n == 0)
        {
         m_lastSig = "";
         reason = "no important event in window";
         return true;
        }

      //--- same events as last judgement: reuse it (no extra API call)
      if(sig == m_lastSig)
        {
         reason = m_lastReason;
         return !m_lastBlock;
        }

      //--- retry throttle after a failure
      if(now < m_nextTry)
        {
         reason = "Jev unavailable (retry wait)";
         return (m_fail == JEV_FAIL_ALLOW);
        }

      if(m_key == "" || !AskJev(symbol, text))
        {
         m_nextTry = now + m_retrySec;
         reason = "Jev error";
         return (m_fail == JEV_FAIL_ALLOW);
        }

      m_lastSig   = sig;
      m_lastBlock = (m_pAvoid >= m_threshold);
      m_lastReason = StringFormat("Jev P(avoid)=%.2f threshold=%.2f events=%d", m_pAvoid, m_threshold, n);
      reason = m_lastReason;
      Print("JevNewsFilter: ", m_lastReason, m_lastBlock ? " -> BLOCK" : " -> ALLOW", "\n", text);
      return !m_lastBlock;
     }
  };

#endif // JEV_NEWS_FILTER_MQH
