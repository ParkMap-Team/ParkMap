@echo off
setlocal
set "PATH=%SystemRoot%\System32\WindowsPowerShell\v1.0;%PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-dev.ps1" %*
set "PARKMAP_EXIT_CODE=%ERRORLEVEL%"
if not "%PARKMAP_EXIT_CODE%"=="0" if "%~1"=="" pause
exit /b %PARKMAP_EXIT_CODE%
