@echo off
rem run-tests.bat - ASCII only, CRLF. Runs npm test.
rem Chain: .bat -> apiguard.ps1 -> node
setlocal
pushd "%~dp0"
echo [run-tests.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apiguard.ps1" test %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-tests.bat] exit code: %EXITCODE%  (0=compatible, 1=breaking changes, 2=error)
popd
if not defined APIGUARD_NO_PAUSE pause
exit /b %EXITCODE%
