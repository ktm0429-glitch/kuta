# kuta — XAUUSD trading bot

Docs: `docs/spec.md`, `docs/architecture.md`, `docs/plan.md`.

```
pip install -e ".[dev]"
pytest
```

Paper (TitanFX demo) only. Live needs `LIVE_ENABLED=true` **and** a `LIVE_APPROVAL.json` file. No broker password is ever used: log in to MT5 manually.
