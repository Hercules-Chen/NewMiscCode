@echo off
rem loadgen.bat - ASCII only, CRLF. Sends demo traffic to the gateway. Example: loadgen.bat --count 100
rem Calls otv.ps1 (loadgen) which calls node. Extra arguments are passed through.
setlocal
pushd "%~dp0"
echo [loadgen] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0otv.ps1" loadgen %*
set "EXITCODE=%ERRORLEVEL%"
echo [loadgen] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
