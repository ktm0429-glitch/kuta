"""Run on the Windows EA PC with MT5 open and logged in (you log in yourself).

    py tools\\export_mt5.py --years 2 --timeframes M5

No password is read or needed; this attaches to the running terminal.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from xbot.mt5_export import ExportError, export  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description="Export MT5 history for backtesting")
    ap.add_argument("--symbol", default="XAUUSD")
    ap.add_argument("--years", type=float, default=2.0)
    ap.add_argument("--timeframes", default="M5", help="comma list, e.g. M5 or M5,M1")
    ap.add_argument("--outdir", default="data")
    ap.add_argument("--no-gzip", action="store_true")
    a = ap.parse_args()

    try:
        import MetaTrader5 as mt5  # type: ignore
    except ImportError:
        print("MetaTrader5 package missing: run  py -m pip install MetaTrader5")
        return 2
    try:
        rep = export(mt5, a.symbol, a.timeframes.split(","), a.years, a.outdir, gzip_output=not a.no_gzip)
    except ExportError as e:
        print(f"ERROR: {e}")
        return 1
    finally:
        mt5.shutdown()

    print(f"Symbol {rep['symbol']}  server offset detected={rep['server_offset_detected_hours']}h "
          f"rule={rep['server_offset_rule_hours']}h match={rep['offset_rule_matches_detected']}")
    warn = []
    if rep["offset_rule_matches_detected"] is False:
        warn.append("Detected server offset differs from the GMT+2/+3 DST rule - tell Claude before using this data.")
    for name, t in rep["timeframes"].items():
        print(f"{name}: {t['bars']} bars  {t['first_bar_utc']} -> {t['last_bar_utc']}  "
              f"spread median={t['spread_points']['median']} p95={t['spread_points']['p95']}  gaps={t['gaps']}")
        if t["bars"] == 0:
            warn.append(f"{name}: no bars exported.")
        elif t["first_bar_utc"] and t["first_bar_utc"] > _years_ago(a.years, 30):
            warn.append(f"{name}: history starts {t['first_bar_utc']} - shorter than the {a.years} years requested.")
        if not t["week_open_consistent"]:
            warn.append(f"{name}: weekly open time is not constant in server time {t['week_open_server_time']} - "
                        "the server may not follow GMT+2/+3 DST; do not use this data until checked.")
    for w in warn:
        print("WARNING:", w)
    print(f"\nFiles written to {a.outdir}/ . Send export_report.json and symbol_info.json (no secrets inside).")
    return 0


def _years_ago(years: float, slack_days: int) -> str:
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(days=years * 365.25 - slack_days)).isoformat()


if __name__ == "__main__":
    raise SystemExit(main())
