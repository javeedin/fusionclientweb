@echo off
REM ============================================================
REM  Re-ERP web server - one-time setup (run as Administrator)
REM  Installs runtime dependencies and opens port 80 in firewall
REM ============================================================
cd /d %~dp0
echo.
echo === Re-ERP server setup ===
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js not found. Install Node LTS first, then rerun.
  pause
  exit /b 1
)
echo Node version:
node -v
echo.
echo Installing runtime dependencies (npm install --omit=dev)...
call npm install --omit=dev
if errorlevel 1 (
  echo ERROR: npm install failed - check the output above.
  pause
  exit /b 1
)
echo.
echo Adding Windows Firewall rule for port 80 (if missing)...
netsh advfirewall firewall show rule name="ReERP-Web" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="ReERP-Web" dir=in action=allow protocol=TCP localport=80
echo.
echo Setup complete.
echo   - To run manually now:            2-start-server.bat
echo   - To auto-start on every reboot:  3-install-autostart.bat
echo.
echo Remember: port 80 must also be open in the OCI security list.
pause
