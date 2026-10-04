import pytest
import yaml
from pydantic import ValidationError

from xbot.strategy_rules import load_strategy, parse_strategy

BASE = yaml.safe_load(open("strategy.example.md").read().split("```yaml")[1].split("```")[0])


def md(d):
    return "# s\n\n```yaml\n" + yaml.safe_dump(d) + "```\n"


def test_example_file_loads():
    r = load_strategy("strategy.example.md")
    assert r.timeframe == "M5" and r.allowed_regimes == ["trending"]
    assert abs(sum(r.weights.model_dump().values()) - 1) < 1e-9


def bad(**patch):
    d = yaml.safe_load(yaml.safe_dump(BASE))
    for k, v in patch.items():
        sec, _, key = k.partition("__")
        if key:
            d[sec][key] = v
        else:
            d[sec] = v
    return d


@pytest.mark.parametrize(
    "patch",
    [
        dict(weights__quality=0.5),                 # weights no longer sum to 1
        dict(thresholds__quality_min=1.2),          # out of range
        dict(thresholds__direction_min=-0.1),
        dict(allowed_regimes=[]),
        dict(allowed_regimes=["sideways"]),
        dict(sizing__max_multiplier=0.5),           # above quarter Kelly
        dict(sizing__p_cutoff=0.9),                 # cutoff >= p_full
        dict(sizing__base_multiplier=0.3),          # base > max
        dict(stops__r_multiple=0),
        dict(stops__horizon_candles=0),
    ],
)
def test_invalid_rules_rejected(patch):
    with pytest.raises(ValidationError):
        parse_strategy(md(bad(**patch)))


def test_unknown_key_rejected():
    d = bad()
    d["bogus"] = 1
    with pytest.raises(ValidationError):
        parse_strategy(md(d))


def test_missing_yaml_block_rejected():
    with pytest.raises(ValueError):
        parse_strategy("# no block here")
