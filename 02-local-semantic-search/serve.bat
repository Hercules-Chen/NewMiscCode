@echo off
rem serve.bat - ASCII only. Wrapper: .bat -> lss.ps1 -> node src\cli.js
setlocal
pushd "%~dp0"
echo [lss] folder: %CD%
echo [lss] starting web UI at http://127.0.0.1:8787/  (Ctrl+C to stop)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lss.ps1" serve %*
set "RC=%ERRORLEVEL%"
echo [lss] exit code: %RC%
popd
pause
exit /b %RC%
