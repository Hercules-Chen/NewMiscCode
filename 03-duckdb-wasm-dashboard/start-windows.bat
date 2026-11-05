@echo off
rem DuckDB-WASM Data Desk - Windows launcher (pure ASCII).
rem Runs start-windows.ps1, which starts "node server.js" and opens the browser.
pushd "%~dp0"
echo [start-windows.bat] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1" %*
set "RC=%ERRORLEVEL%"
echo [start-windows.bat] exit code: %RC%
popd
pause
exit /b %RC%
