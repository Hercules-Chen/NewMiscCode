@echo off
rem run-tests.bat - ASCII only, CRLF. Runs npm test.
rem Chain: .bat -> ui-recorder.ps1 -> node
setlocal
pushd "%~dp0"
echo [run-tests.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ui-recorder.ps1" test %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-tests.bat] exit code: %EXITCODE%  (0=all tests passed, 1=failures)
popd
if not defined UIREC_NO_PAUSE pause
exit /b %EXITCODE%
