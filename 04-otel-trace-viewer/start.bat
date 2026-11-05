@echo off
rem start.bat - ASCII only, CRLF. Starts collector + viewer + demo services. Example: start.bat --debug --load 30
rem Calls otv.ps1 (start) which calls node. Extra arguments are passed through.
setlocal
pushd "%~dp0"
echo [start] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0otv.ps1" start %*
set "EXITCODE=%ERRORLEVEL%"
echo [start] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
