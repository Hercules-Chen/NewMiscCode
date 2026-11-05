@echo off
rem Install dev deps if needed, then run npm test (unit + Playwright e2e)
setlocal
pushd "%~dp0"
echo [08-pwa-offline-sync] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pwa.ps1" test %*
set "EXITCODE=%ERRORLEVEL%"
echo.
echo [08-pwa-offline-sync] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
