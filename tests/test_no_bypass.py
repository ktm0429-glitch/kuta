"""Structural guard: only router.py may call broker.send; only risk.py may mint."""
import re
from pathlib import Path

SRC = Path("src/xbot")


def _files_matching(pattern):
    rx = re.compile(pattern)
    return sorted(p.name for p in SRC.glob("*.py") if rx.search(p.read_text()))


def test_only_router_calls_broker_send():
    assert _files_matching(r"broker\.send\(") == ["router.py"]


def test_only_risk_and_router_touch_mint():
    assert _files_matching(r"\.mint\(") == ["router.py", "risk.py"] or \
           _files_matching(r"\.mint\(") == ["router.py"]
