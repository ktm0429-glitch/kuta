"""Log redaction so secrets never reach logs."""
from __future__ import annotations

import logging
import os
import re

_TELEGRAM_TOKEN = re.compile(r"\d{6,}:[A-Za-z0-9_-]{30,}")
_SECRET_ENV_VARS = ("TELEGRAM_BOT_TOKEN",)
MASK = "***"


def _redact(text: str, secrets: list[str]) -> str:
    for s in secrets:
        text = text.replace(s, MASK)
    return _TELEGRAM_TOKEN.sub(MASK, text)


class RedactingFilter(logging.Filter):
    def __init__(self, secrets: list[str]):
        super().__init__()
        self._secrets = [s for s in secrets if s]

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = _redact(record.getMessage(), self._secrets)
        record.args = None
        return True


def setup_logging(level: int = logging.INFO) -> None:
    """Redact at record creation so every logger and handler is covered."""
    secrets = [os.environ[v] for v in _SECRET_ENV_VARS if os.environ.get(v)]
    old_factory = logging.getLogRecordFactory()

    def factory(*args, **kwargs):
        record = old_factory(*args, **kwargs)
        record.msg = _redact(record.getMessage(), secrets)
        record.args = None
        return record

    logging.setLogRecordFactory(factory)
    logging.basicConfig(level=level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
