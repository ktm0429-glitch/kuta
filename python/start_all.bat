@echo off
REM KUTA ML EA — Python サービス一括起動スクリプト
REM このファイルをダブルクリック、またはPCログイン時に自動実行してください

cd /d "%~dp0"

echo [KUTA ML] Python環境チェック中...
python --version >nul 2>&1
if errorlevel 1 (
    echo Pythonが見つかりません。Python 3.10以上をインストールしてください。
    pause
    exit /b 1
)

echo [KUTA ML] 依存ライブラリインストール中...
pip install -r requirements.txt -q

echo [KUTA ML] MLサーバー起動中 (localhost:5000)...
start "KUTA-ML-Server" /min cmd /c "python ml_server.py >> ..\data\server.log 2>&1"

timeout /t 3 /nobreak >nul

echo [KUTA ML] 自動学習スケジューラー起動中...
start "KUTA-ML-Scheduler" /min cmd /c "python scheduler.py >> ..\data\scheduler.log 2>&1"

echo [KUTA ML] 起動完了！
echo   MLサーバー: http://localhost:5000/health
echo   ログ: ..\data\server.log
echo.
echo このウィンドウを閉じても大丈夫です。
timeout /t 5
