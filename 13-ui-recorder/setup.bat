@echo off
rem setup.bat - ASCII only, CRLF. Checks Node.js and Playwright.
rem Chain: .bat -> ui-recorder.ps1 -> node
setlocal
pushd "%~dp0"
echo [setup.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ui-recorder.ps1" setup %*
set "EXITCODE=%ERRORLEVEL%"
echo [setup.bat] exit code: %EXITCODE%  (0=ok, 3=Playwright missing, 9009=node missing)
popd
if not defined UIREC_NO_PAUSE pause
exit /b %EXITCODE%
