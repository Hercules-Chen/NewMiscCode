@echo off
rem run-tests.bat - ASCII only. Calls collab.ps1 (test) which calls node.
setlocal
pushd "%~dp0"
echo [run-tests.bat] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0collab.ps1" test %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-tests.bat] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
