@echo off
rem run-tests.bat - ASCII only. Runs npm test (node --test).
rem Chain: run-tests.bat -> vr.ps1 -> node
setlocal
pushd "%~dp0"
echo [run-tests] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vr.ps1" test %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-tests] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
