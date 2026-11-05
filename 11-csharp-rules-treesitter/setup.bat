@echo off
rem setup.bat - ASCII only, CRLF. Calls csrules.ps1 (setup) which calls node.
setlocal
pushd "%~dp0"
echo [setup] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0csrules.ps1" setup %*
set "EXITCODE=%ERRORLEVEL%"
echo [setup] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
