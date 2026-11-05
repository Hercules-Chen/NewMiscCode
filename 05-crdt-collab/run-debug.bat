@echo off
rem run-debug.bat - ASCII only. Calls collab.ps1 (debug) which calls node.
setlocal
pushd "%~dp0"
echo [run-debug.bat] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0collab.ps1" debug %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-debug.bat] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
