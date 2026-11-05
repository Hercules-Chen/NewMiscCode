@echo off
rem run-sample.bat - ASCII only, CRLF. Calls csrules.ps1 (sample) which calls node.
setlocal
pushd "%~dp0"
echo [run-sample] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0csrules.ps1" sample %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-sample] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
