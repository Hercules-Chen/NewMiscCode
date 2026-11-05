@echo off
rem Start the PWA server (default http://localhost:8808/). Extra args go to node src/cli.js, e.g. start.bat --port 8809
setlocal
pushd "%~dp0"
echo [08-pwa-offline-sync] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pwa.ps1" start %*
set "EXITCODE=%ERRORLEVEL%"
echo.
echo [08-pwa-offline-sync] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
