@echo off
rem Start the server with --debug (debug-level JSONL logs)
setlocal
pushd "%~dp0"
echo [08-pwa-offline-sync] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pwa.ps1" dev %*
set "EXITCODE=%ERRORLEVEL%"
echo.
echo [08-pwa-offline-sync] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
