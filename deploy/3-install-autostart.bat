@echo off
REM ============================================================
REM  Re-ERP web server - install as auto-start background task
REM  (run as Administrator; uses built-in Task Scheduler)
REM ============================================================
set DIR=%~dp0
set DIR=%DIR:~0,-1%
schtasks /create /f /tn "ReERP-Web" /sc onstart /ru SYSTEM /tr "cmd /c cd /d %DIR% && set REERP_PORT=80 && node server\proxy.cjs"
if errorlevel 1 (
  echo ERROR: could not create the scheduled task. Run this file as Administrator.
  pause
  exit /b 1
)
schtasks /run /tn "ReERP-Web"
echo.
echo Re-ERP is installed as a startup task and has been started now.
echo Test in the browser: http://localhost
echo To restart after a new deploy: 4-restart.bat
pause
