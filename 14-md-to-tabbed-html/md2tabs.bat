@echo off
rem md2tabs.bat - ASCII only, CRLF. Generic CLI: md2tabs.bat build docs.md --out docs.html --check
rem Chain: .bat -> md2tabs.ps1 -> node
setlocal
pushd "%~dp0"
echo [md2tabs.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0md2tabs.ps1" cli %*
set "EXITCODE=%ERRORLEVEL%"
echo [md2tabs.bat] exit code: %EXITCODE%  (0=ok, 1=check problems, 2=usage, 3=encoding, 4=I/O)
popd
if not defined MD2TABS_NO_PAUSE pause
exit /b %EXITCODE%
