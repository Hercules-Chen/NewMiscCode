@echo off
rem run-server.bat - ASCII only. Calls collab.ps1 (start) which calls node.
setlocal
pushd "%~dp0"
echo [run-server.bat] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0collab.ps1" start %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-server.bat] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
