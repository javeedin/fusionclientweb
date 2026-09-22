@echo off
REM ============================================================
REM  Re-ERP web server - manual start (window must stay open)
REM  Port is 80 unless port.txt next to this file says otherwise.
REM ============================================================
cd /d %~dp0
set REERP_PORT=80
if exist "%~dp0port.txt" set /p REERP_PORT=<"%~dp0port.txt"
echo Starting Re-ERP web server on port %REERP_PORT% ...
echo Press Ctrl+C to stop.
node server\proxy.cjs
pause
