@echo off
REM ============================================================
REM  Re-ERP web server - restart after a new Deploy Runtime
REM ============================================================
echo Stopping Re-ERP (all node processes on this server)...
taskkill /f /im node.exe >nul 2>&1
timeout /t 2 /nobreak >nul
schtasks /run /tn "ReERP-Web" 2>nul
if errorlevel 1 (
  echo Startup task not installed - starting manually instead...
  start "" "%~dp02-start-server.bat"
)
echo Restarted. Test: http://localhost
pause
