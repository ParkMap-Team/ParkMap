@echo off
setlocal
rem Short entry point for the motorcycle detector. Settings: tools\yolo-training\detection\config.yaml
rem Details: tools\yolo-training\detection\README.md
set "DET=%~dp0tools\yolo-training\detection"
rem Shares the CUDA environment built by "train-classifier setup"; falls back to the API environment (CPU-only PyTorch).
set "PY=%~dp0tools\yolo-training\.venv-gpu\Scripts\python.exe"
if not exist "%PY%" set "PY=%~dp0apps\vision-api\.venv\Scripts\python.exe"
if not exist "%PY%" (
    echo No Python environment found. Run: train-classifier setup
    exit /b 1
)
rem The Windows certificate store may lack github.com's root; certifi's bundle covers the one-time weight download.
for %%i in ("%PY%") do set "CA=%%~dpi..\Lib\site-packages\certifi\cacert.pem"
if exist "%CA%" set "SSL_CERT_FILE=%CA%"

set "MODE=%~1"
if /i "%MODE%"=="check" (
    "%PY%" "%DET%\train.py" --check
    exit /b %ERRORLEVEL%
)
if /i "%MODE%"=="test" (
    "%PY%" "%DET%\train.py" --test
    exit /b %ERRORLEVEL%
)
if /i "%MODE%"=="run" (
    if "%~2"=="" (
        "%PY%" "%DET%\train.py"
    ) else (
        "%PY%" "%DET%\train.py" --model %2
    )
    exit /b %ERRORLEVEL%
)
echo Usage: train-detector ^<check ^| run ^| test^> [model]
echo.
echo   check          verify dataset and list every model with its settings; trains nothing
echo   run [model]    pick model(s) from a menu, or name one (all = every model in turn)
echo   test           pick a finished run and evaluate it once on the held-out test split
echo.
echo All settings: %DET%\config.yaml
echo Results: %DET%\runs\^<model^>\round-NN_^<date^>_^<time^>\ and %DET%\runs\history.csv
exit /b 1
