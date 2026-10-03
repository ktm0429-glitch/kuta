from conftest import T0
from xbot.journal import Journal


def test_log_and_read_back(tmp_path):
    j = Journal(tmp_path / "j.sqlite")
    j.log("decision", {"p": 0.61, "action": "none"}, T0)
    j.log("fill", {"price": 2000.2}, T0)
    assert [e["type"] for e in j.events()] == ["decision", "fill"]
    assert j.events("fill")[0]["payload"]["price"] == 2000.2


def test_persists_across_instances(tmp_path):
    Journal(tmp_path / "j.sqlite").log("x", {"a": 1}, T0)
    assert len(Journal(tmp_path / "j.sqlite").events()) == 1
