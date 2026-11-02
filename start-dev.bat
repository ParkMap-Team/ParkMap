@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-dev.ps1" %*
set "PARKMAP_EXIT_CODE=%ERRORLEVEL%"
if not "%PARKMAP_EXIT_CODE%"=="0" if "%~1"=="" pause
exit /b %PARKMAP_EXIT_CODE%
