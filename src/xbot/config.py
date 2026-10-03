"""Configuration. Hard limits live here and in config/risk.yaml, never in prompts."""
from __future__ import annotations

import os
from pathlib import Path

import yaml
from pydantic import BaseModel, ConfigDict, Field, SecretStr


class RiskConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    symbol: str
    timeframe: str
    max_position_lots: float = Field(gt=0)
    max_open_positions: int = Field(gt=0)
    daily_loss_limit_pct: float = Field(gt=0, le=100)
    max_drawdown_pct: float = Field(gt=0, le=100)
    approval_threshold_lots: float = Field(gt=0)
    max_spread_points: float = Field(gt=0)
    stale_data_candles: int = Field(gt=0)
    max_consecutive_errors: int = Field(gt=0)
    kelly_fraction_cap: float = Field(gt=0, le=0.25)


class Settings(BaseModel):
    model_config = ConfigDict(frozen=True)

    telegram_bot_token: SecretStr | None = None
    telegram_chat_id: str | None = None
    live_enabled: bool = False


def load_risk_config(path: str | Path = "config/risk.yaml") -> RiskConfig:
    with open(path, encoding="utf-8") as f:
        return RiskConfig(**(yaml.safe_load(f) or {}))


def load_settings(approval_file: str | Path = "LIVE_APPROVAL.json") -> Settings:
    """Live mode needs BOTH LIVE_ENABLED=true and an approval file on disk."""
    flag = os.environ.get("LIVE_ENABLED", "false").strip().lower() == "true"
    live = flag and Path(approval_file).is_file()
    token = os.environ.get("TELEGRAM_BOT_TOKEN") or None
    return Settings(
        telegram_bot_token=SecretStr(token) if token else None,
        telegram_chat_id=os.environ.get("TELEGRAM_CHAT_ID") or None,
        live_enabled=live,
    )
