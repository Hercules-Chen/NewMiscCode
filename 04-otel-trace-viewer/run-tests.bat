@echo off
rem run-tests.bat - ASCII only, CRLF. Runs the end-to-end test suite (npm test).
rem Calls otv.ps1 (test) which calls node. Extra arguments are passed through.
setlocal
pushd "%~dp0"
echo [run-tests] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0otv.ps1" test %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-tests] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
