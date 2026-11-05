@echo off
rem start.bat - ASCII only. Wrapper: .bat -> passkeys.ps1 -> node src\cli.js
rem Usage: start.bat [--debug] [--port 3007] [--rp-id localhost] [--origin http://localhost:3007]
setlocal
pushd "%~dp0"
echo [passkeys] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0passkeys.ps1" %*
set "RC=%ERRORLEVEL%"
echo [passkeys] exit code: %RC%
popd
pause
exit /b %RC%
