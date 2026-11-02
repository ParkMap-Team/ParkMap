@echo off
setlocal
rem Use the full path so the launcher still works when PATH lacks WindowsPowerShell.
set "PARKMAP_POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PARKMAP_POWERSHELL%" set "PARKMAP_POWERSHELL=%windir%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PARKMAP_POWERSHELL%" set "PARKMAP_POWERSHELL=powershell.exe"
"%PARKMAP_POWERSHELL%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\start-dev.ps1" %*
set "PARKMAP_EXIT_CODE=%ERRORLEVEL%"
if not "%PARKMAP_EXIT_CODE%"=="0" if "%~1"=="" pause
exit /b %PARKMAP_EXIT_CODE%
