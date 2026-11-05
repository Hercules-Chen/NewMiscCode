@echo off
rem run-demo.bat - ASCII only, CRLF. Runs the full demo (diff + record + replay).
rem Chain: .bat -> apiguard.ps1 -> node
setlocal
pushd "%~dp0"
echo [run-demo.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apiguard.ps1" demo %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-demo.bat] exit code: %EXITCODE%  (0=compatible, 1=breaking changes, 2=error)
popd
if not defined APIGUARD_NO_PAUSE pause
exit /b %EXITCODE%
