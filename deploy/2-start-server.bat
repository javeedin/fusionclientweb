@echo off
REM ============================================================
REM  Re-ERP web server - manual start (window must stay open)
REM ============================================================
cd /d %~dp0
set REERP_PORT=80
echo Starting Re-ERP web server on port %REERP_PORT% ...
echo Press Ctrl+C to stop.
node server\proxy.cjs
pause
