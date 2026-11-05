@echo off
rem start-debug.bat - ASCII only. Same as start.bat with --debug (debug log level + /debug page).
setlocal
pushd "%~dp0"
echo [passkeys] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0passkeys.ps1" --debug %*
set "RC=%ERRORLEVEL%"
echo [passkeys] exit code: %RC%
popd
pause
exit /b %RC%
