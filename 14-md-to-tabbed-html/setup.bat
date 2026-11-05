@echo off
rem setup.bat - ASCII only, CRLF. Chain: .bat -> md2tabs.ps1 setup -> node
setlocal
pushd "%~dp0"
echo [setup.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0md2tabs.ps1" setup
set "EXITCODE=%ERRORLEVEL%"
echo [setup.bat] exit code: %EXITCODE%
popd
if not defined MD2TABS_NO_PAUSE pause
exit /b %EXITCODE%
