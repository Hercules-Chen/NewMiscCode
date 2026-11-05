@echo off
rem build-docs.bat - ASCII only, CRLF. Chain: .bat -> md2tabs.ps1 build-docs -> node
setlocal
pushd "%~dp0"
echo [build-docs.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0md2tabs.ps1" build-docs
set "EXITCODE=%ERRORLEVEL%"
echo [build-docs.bat] exit code: %EXITCODE%
popd
if not defined MD2TABS_NO_PAUSE pause
exit /b %EXITCODE%
