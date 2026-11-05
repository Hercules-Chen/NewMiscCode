@echo off
rem run-demo.bat - ASCII only. Calls uiv.ps1 (demo) which calls node.
setlocal
pushd "%~dp0"
echo [run-demo] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uiv.ps1" demo %*
set "EXITCODE=%ERRORLEVEL%"
echo [run-demo] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
