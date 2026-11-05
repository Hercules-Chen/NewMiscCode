@echo off
rem setup.bat - ASCII only. Installs Playwright + Chromium (npm install, npx playwright install chromium).
rem Chain: setup.bat -> vr.ps1 -> node
setlocal
pushd "%~dp0"
echo [setup] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vr.ps1" setup %*
set "EXITCODE=%ERRORLEVEL%"
echo [setup] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
