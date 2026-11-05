@echo off
rem csrules.bat - ASCII only, CRLF. Calls csrules.ps1 (check) which calls node.
setlocal
pushd "%~dp0"
echo [csrules] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0csrules.ps1" check %*
set "EXITCODE=%ERRORLEVEL%"
echo [csrules] exit code: %EXITCODE%
popd
if not defined CSRULES_NO_PAUSE pause
exit /b %EXITCODE%
