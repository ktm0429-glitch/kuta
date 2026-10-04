"""Machine-readable strategy rules: the fenced ```yaml block inside strategy.md."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, model_validator

Regime = Literal["trending", "ranging", "volatile"]
_P = Field(ge=0, le=1)


class _Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Thresholds(_Frozen):
    direction_min: float = _P
    pressure_min: float = _P
    quality_min: float = _P
    regime_min: float = _P
    risk_normal_min: float = _P
    risk_halt_max: float = _P
    combined_min: float = _P


class Weights(_Frozen):
    direction: float = _P
    pressure: float = _P
    quality: float = _P
    regime: float = _P
    risk: float = _P

    @model_validator(mode="after")
    def _sum_to_one(self):
        if abs(sum(self.model_dump().values()) - 1.0) > 1e-6:
            raise ValueError("weights must sum to 1")
        return self


class Stops(_Frozen):
    stop_vol_mult: float = Field(gt=0)
    min_stop_points: float = Field(gt=0)
    r_multiple: float = Field(gt=0)
    horizon_candles: int = Field(gt=0)


class SizingRules(_Frozen):
    p_cutoff: float = _P
    p_full: float = _P
    base_multiplier: float = Field(ge=0, le=0.25)
    max_multiplier: float = Field(gt=0, le=0.25)  # never above quarter Kelly

    @model_validator(mode="after")
    def _ordered(self):
        if not self.p_cutoff < self.p_full:
            raise ValueError("p_cutoff must be below p_full")
        if self.base_multiplier > self.max_multiplier:
            raise ValueError("base_multiplier must not exceed max_multiplier")
        return self


class StrategyRules(_Frozen):
    timeframe: str
    thresholds: Thresholds
    allowed_regimes: list[Regime] = Field(min_length=1)
    weights: Weights
    stops: Stops
    sizing: SizingRules
    invalidation: str


_BLOCK = re.compile(r"```yaml\s*\n(.*?)```", re.DOTALL)


def parse_strategy(text: str) -> StrategyRules:
    m = _BLOCK.search(text)
    if not m:
        raise ValueError("strategy file has no ```yaml block")
    return StrategyRules(**(yaml.safe_load(m.group(1)) or {}))


def load_strategy(path: str | Path = "strategy.md") -> StrategyRules:
    return parse_strategy(Path(path).read_text(encoding="utf-8"))
