@echo off
rem serve-demo.bat - ASCII only. Calls uiv.ps1 (serve-demo) which calls node.
setlocal
pushd "%~dp0"
echo [serve-demo] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uiv.ps1" serve-demo %*
set "EXITCODE=%ERRORLEVEL%"
echo [serve-demo] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
