import logging

from xbot.logging_utils import RedactingFilter, setup_logging


def test_known_secret_is_redacted(caplog):
    log = logging.getLogger("t1")
    log.addFilter(RedactingFilter(["123456:SECRET-TOKEN-VALUE"]))
    with caplog.at_level(logging.INFO, logger="t1"):
        log.info("sending with token 123456:SECRET-TOKEN-VALUE now")
    assert "SECRET-TOKEN-VALUE" not in caplog.text
    assert "***" in caplog.text


def test_secret_in_format_args_is_redacted(caplog):
    log = logging.getLogger("t2")
    log.addFilter(RedactingFilter(["abc-secret"]))
    with caplog.at_level(logging.INFO, logger="t2"):
        log.info("token=%s", "abc-secret")
    assert "abc-secret" not in caplog.text


def test_telegram_token_pattern_redacted_even_if_unregistered(caplog):
    log = logging.getLogger("t3")
    log.addFilter(RedactingFilter([]))
    with caplog.at_level(logging.INFO, logger="t3"):
        log.info("url https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/send")
    assert "AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw" not in caplog.text


def test_setup_logging_registers_env_secrets(monkeypatch, caplog):
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "999:ZZZ-env-secret")
    setup_logging()
    log = logging.getLogger("xbot.t4")
    with caplog.at_level(logging.INFO, logger="xbot.t4"):
        log.info("leak 999:ZZZ-env-secret")
    assert "ZZZ-env-secret" not in caplog.text
