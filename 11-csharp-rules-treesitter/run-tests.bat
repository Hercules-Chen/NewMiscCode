@echo off
rem run-tests.bat - ASCII only, CRLF. Calls csrules.ps1 (test) which calls node.
setlocal
pushd "%~dp0"
echo [run-tests] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0csrules.ps1" test %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-tests] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
