@echo off
setlocal
rem Short entry point for the motorcycle-family classifier. Settings: tools\yolo-training\classification\experiments.json
rem Details: tools\yolo-training\classification\TRAINING.md
set "CLS=%~dp0tools\yolo-training\classification"
set "GPU_ENV=%~dp0tools\yolo-training\.venv-gpu"
set "CONFIG=%CLS%\experiments.json"
rem Prefer the CUDA environment; fall back to the API environment (CPU-only PyTorch).
set "PY=%GPU_ENV%\Scripts\python.exe"
if not exist "%PY%" set "PY=%~dp0apps\vision-api\.venv\Scripts\python.exe"

set "MODE=%~1"
set "MODEL="
set "FIRST=%~2"
shift
rem The first argument after the mode is a model name unless it is empty or starts with a dash (an option).
if not "%FIRST%"=="" if not "%FIRST:~0,1%"=="-" (
    set "MODEL=%FIRST%"
    shift
)
set "EXTRA="
:collect
if "%~1"=="" goto collected
set EXTRA=%EXTRA% %1
shift
goto collect
:collected

if /i "%MODE%"=="setup" goto setup
if not exist "%PY%" (
    echo No Python environment found. Run: train-classifier setup
    exit /b 1
)
if /i "%MODE%"=="check" goto check
if /i "%MODE%"=="run" goto run
if /i "%MODE%"=="test" goto test

echo Usage: train-classifier ^<check ^| run ^| test ^| setup^> [model] [extra train.py options]
echo.
echo   check          show every model's settings and verify the dataset; trains nothing
echo   run [model]    pick a model from a menu, or name it (the name all trains every model in turn)
echo   test [model]   evaluate the newest run (of that model) on the held-out test split, once
echo   setup          create the CUDA environment for the GPU (one time, needs internet)
echo.
echo Models, patience, epochs and the rest are edited in one place: %CLS%\experiments.json
echo Results: %CLS%\runs\summary.csv (one row per finished run) and one folder per run.
echo Examples: train-classifier run
echo           train-classifier run yolo26n
echo           train-classifier run resnet18 --epochs 10 --device cpu
exit /b 1

:device
"%PY%" -c "import torch; print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU only (run: train-classifier setup)')"
exit /b %ERRORLEVEL%

:check
call :device || exit /b 1
"%PY%" "%CLS%\train.py" --config "%CONFIG%" --model all --validate-only %EXTRA% || exit /b 1
echo Check passed.
exit /b 0

:run
call :device || exit /b 1
rem The Windows certificate store may lack github.com's root; add certifi's Mozilla bundle for the one-time weight download.
for %%i in ("%PY%") do set "CA=%%~dpi..\Lib\site-packages\certifi\cacert.pem"
if exist "%CA%" set "SSL_CERT_FILE=%CA%"
if not defined MODEL (
    "%PY%" "%CLS%\train.py" --config "%CONFIG%" --choose %EXTRA%
    exit /b %ERRORLEVEL%
)
"%PY%" "%CLS%\train.py" --config "%CONFIG%" --model %MODEL% %EXTRA%
exit /b %ERRORLEVEL%

:test
set "PATTERN=train-*"
if defined MODEL set "PATTERN=train-*-%MODEL:_=-%-*"
set "LATEST="
for /f "delims=" %%d in ('dir /b /ad /o-d "%CLS%\runs\%PATTERN%" 2^>nul') do if not defined LATEST set "LATEST=%%d"
if not defined LATEST (
    echo No trained run found. Run: train-classifier run
    exit /b 1
)
if not exist "%CLS%\runs\%LATEST%\best.pt" (
    echo %LATEST% has no best.pt; it did not finish an epoch.
    exit /b 1
)
echo Held-out test evaluation of %LATEST%
"%PY%" "%CLS%\train.py" --config "%CONFIG%" --evaluate-test --checkpoint "%CLS%\runs\%LATEST%\best.pt" %EXTRA%
exit /b %ERRORLEVEL%

:setup
rem Versions mirror apps\vision-api\uv.lock; only the PyTorch build differs (CUDA 13.0 instead of CPU).
set "UV=uv"
where uv >nul 2>&1 || set "UV=%USERPROFILE%\.local\bin\uv.exe"
set "PY=%GPU_ENV%\Scripts\python.exe"
"%UV%" venv "%GPU_ENV%" --python 3.12 --allow-existing || exit /b 1
"%UV%" pip install --python "%PY%" --index-url https://download.pytorch.org/whl/cu130 torch==2.14.1 torchvision==0.29.1 || exit /b 1
"%UV%" pip install --python "%PY%" ultralytics==8.4.166 pillow==11.3.0 pyyaml==6.0.3 || exit /b 1
call :device
exit /b %ERRORLEVEL%
