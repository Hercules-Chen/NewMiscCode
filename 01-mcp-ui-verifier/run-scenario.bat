@echo off
rem run-scenario.bat - ASCII only. Calls uiv.ps1 (run) which calls node.
setlocal
pushd "%~dp0"
echo [run-scenario] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uiv.ps1" run %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-scenario] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
