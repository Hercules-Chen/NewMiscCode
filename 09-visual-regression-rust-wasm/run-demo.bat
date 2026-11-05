@echo off
rem run-demo.bat - ASCII only. Demo: screenshot demo v1, approve, screenshot v2, write report.
rem Chain: run-demo.bat -> vr.ps1 -> node
setlocal
pushd "%~dp0"
echo [run-demo] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vr.ps1" demo %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-demo] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
