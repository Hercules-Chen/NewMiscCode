@echo off
rem run-tests.bat - ASCII only, CRLF. Chain: .bat -> md2tabs.ps1 test -> node
setlocal
pushd "%~dp0"
echo [run-tests.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0md2tabs.ps1" test
set "EXITCODE=%ERRORLEVEL%"
echo [run-tests.bat] exit code: %EXITCODE%
popd
if not defined MD2TABS_NO_PAUSE pause
exit /b %EXITCODE%
