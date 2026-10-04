import pytest
from pydantic import ValidationError

from xbot.config import RiskConfig, load_risk_config, load_settings


def test_load_risk_config_from_repo_file():
    cfg = load_risk_config("config/risk.yaml")
    assert cfg.symbol == "XAUUSD"
    assert cfg.timeframe == "M5"
    assert cfg.approval_threshold_lots == 0.05
    assert cfg.kelly_fraction_cap == 0.25


def test_risk_config_rejects_unknown_keys(tmp_path):
    p = tmp_path / "risk.yaml"
    p.write_text("symbol: XAUUSD\nbogus: 1\n")
    with pytest.raises(ValidationError):
        load_risk_config(p)


def test_risk_config_rejects_nonpositive_limits():
    with pytest.raises(ValidationError):
        RiskConfig(
            symbol="XAUUSD", timeframe="M5", max_position_lots=0,
            max_open_positions=1, max_risk_per_trade_pct=1.0, daily_loss_limit_pct=2, max_drawdown_pct=10,
            approval_threshold_lots=0.05, max_spread_points=60,
            stale_data_candles=2, max_consecutive_errors=3,
            kelly_fraction_cap=0.25,
        )


def test_kelly_cap_cannot_exceed_one_quarter():
    with pytest.raises(ValidationError):
        RiskConfig(
            symbol="XAUUSD", timeframe="M5", max_position_lots=0.1,
            max_open_positions=1, max_risk_per_trade_pct=1.0, daily_loss_limit_pct=2, max_drawdown_pct=10,
            approval_threshold_lots=0.05, max_spread_points=60,
            stale_data_candles=2, max_consecutive_errors=3,
            kelly_fraction_cap=0.5,
        )


def test_live_is_off_by_default(monkeypatch):
    monkeypatch.delenv("LIVE_ENABLED", raising=False)
    assert load_settings().live_enabled is False


def test_live_flag_alone_is_not_enough(monkeypatch, tmp_path):
    monkeypatch.setenv("LIVE_ENABLED", "true")
    s = load_settings(approval_file=tmp_path / "LIVE_APPROVAL.json")
    assert s.live_enabled is False


def test_live_needs_flag_and_approval_file(monkeypatch, tmp_path):
    f = tmp_path / "LIVE_APPROVAL.json"
    f.write_text('{"approved_by": "user"}')
    monkeypatch.setenv("LIVE_ENABLED", "true")
    assert load_settings(approval_file=f).live_enabled is True


def test_settings_repr_hides_secrets(monkeypatch):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456:SECRET-TOKEN-VALUE")
    s = load_settings()
    assert "SECRET-TOKEN-VALUE" not in repr(s)
    assert "SECRET-TOKEN-VALUE" not in str(s)
