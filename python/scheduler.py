"""
自動再学習スケジューラー
毎日 03:00 (ロンドン・NY市場クローズ後) に再学習を実行し、
サーバーにモデルリロードを通知する。
"""

import logging
import time
import urllib.request
from datetime import datetime
from pathlib import Path

import schedule

from trainer import train

LOG = logging.getLogger(__name__)
SERVER_URL = "http://127.0.0.1:5000"


def retrain_and_reload():
    LOG.info("=== 自動再学習開始 ===")
    try:
        metrics = train()
        LOG.info(f"学習完了 — AUC: {metrics['mean_auc']:.4f}, サンプル数: {metrics['n_samples']}")

        # サーバーにモデルリロードを通知
        req = urllib.request.Request(
            f"{SERVER_URL}/reload",
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read()
            LOG.info(f"モデルリロード完了: {body.decode()}")

    except FileNotFoundError as e:
        LOG.warning(f"データ未取得のためスキップ: {e}")
    except Exception as e:
        LOG.exception(f"再学習エラー: {e}")


def main():
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[
            logging.StreamHandler(),
            logging.FileHandler(Path(__file__).parent.parent / "data" / "scheduler.log"),
        ],
    )

    LOG.info("スケジューラー起動")

    # 毎日 03:00 に再学習
    schedule.every().day.at("03:00").do(retrain_and_reload)

    # 起動直後にも一度実行（モデルがなければスキップ）
    retrain_and_reload()

    LOG.info("スケジュール設定完了: 毎日 03:00 に自動再学習")

    while True:
        schedule.run_pending()
        time.sleep(60)


if __name__ == "__main__":
    main()
