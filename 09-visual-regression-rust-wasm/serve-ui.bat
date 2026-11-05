@echo off
rem serve-ui.bat - ASCII only. Starts the browser UI on http://127.0.0.1:5179/
rem Chain: serve-ui.bat -> vr.ps1 -> node
setlocal
pushd "%~dp0"
echo [serve-ui] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vr.ps1" serve %*
set "EXITCODE=%ERRORLEVEL%"
echo [serve-ui] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
