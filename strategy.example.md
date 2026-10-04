# Strategy (EXAMPLE TEMPLATE — untested placeholder, NOT a validated strategy)

`strategy.md` is written only after a candidate passes the acceptance gates (docs/gates.md) out of sample.
Until then this file only documents the format. The YAML block is read by code; the prose is for humans.

- **Entry**: on candle close, when every probability below clears its threshold and the weighted score clears `combined_min`.
- **Exit**: stop = `stop_vol_mult` x per-candle volatility x price (floor `min_stop_points`); take profit = `r_multiple` x stop.
- **Timeframe**: M5.
- **Invalidation**: P(risk_state = halt) above `risk_halt_max`, P(risk_state = normal) below `risk_normal_min`, or the regime leaving `allowed_regimes`.

```yaml
timeframe: M5
thresholds:            # a probability must be >= its threshold
  direction_min: 0.50
  pressure_min: 0.50
  quality_min: 0.50
  regime_min: 0.40
  risk_normal_min: 0.50
  risk_halt_max: 0.15  # P(halt) must be <= this
  combined_min: 0.50
allowed_regimes: [trending]
weights:               # must sum to 1
  direction: 0.25
  pressure: 0.15
  quality: 0.40
  regime: 0.10
  risk: 0.10
stops:
  stop_vol_mult: 4.0
  min_stop_points: 300
  r_multiple: 1.5
  horizon_candles: 24
sizing:
  p_cutoff: 0.50       # below this probability: zero size
  p_full: 0.65         # at/above: max Kelly multiplier
  base_multiplier: 0.10
  max_multiplier: 0.25 # never more than quarter Kelly
invalidation: "P(halt) > risk_halt_max, P(normal) < risk_normal_min, or regime not in allowed_regimes"
```
