@echo off
rem setup.bat - ASCII only, CRLF. Installs npm dependencies and the Playwright Chromium (for tests).
rem Calls otv.ps1 (setup) which calls node. Extra arguments are passed through.
setlocal
pushd "%~dp0"
echo [setup] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0otv.ps1" setup %*
set "EXITCODE=%ERRORLEVEL%"
echo [setup] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
