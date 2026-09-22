@echo off
REM ============================================================
REM  Re-ERP web server - one-time setup (run as Administrator)
REM  Installs runtime dependencies and opens the web port in the
REM  Windows Firewall. Port is 80 unless port.txt says otherwise.
REM ============================================================
cd /d %~dp0
set REERP_PORT=80
if exist "%~dp0port.txt" set /p REERP_PORT=<"%~dp0port.txt"
echo.
echo === Re-ERP server setup (port %REERP_PORT%) ===
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
echo Adding Windows Firewall rule for port %REERP_PORT% (if missing)...
netsh advfirewall firewall show rule name="ReERP-Web-%REERP_PORT%" >nul 2>&1
if errorlevel 1 netsh advfirewall firewall add rule name="ReERP-Web-%REERP_PORT%" dir=in action=allow protocol=TCP localport=%REERP_PORT%
echo.
echo Setup complete.
echo   - To run manually now:            2-start-server.bat
echo   - To auto-start on every reboot:  3-install-autostart.bat
echo.
echo Remember: port %REERP_PORT% must also be open in the OCI security list.
pause
