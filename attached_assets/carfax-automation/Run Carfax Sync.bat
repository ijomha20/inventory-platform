@echo off
cd /d "%~dp0"
echo.
echo  CARFAX AUTOMATION v1.3
echo.
echo  1. Run once  (process current VINs and exit)
echo  2. Watch mode (keep running, auto-checks every 5 min for new VINs)
echo.
set /p choice="Enter 1 or 2: "
echo.
if "%choice%"=="2" (
  node carfax-sync.js --watch
) else (
  node carfax-sync.js
)
pause
