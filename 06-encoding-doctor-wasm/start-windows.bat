@echo off
rem Encoding Doctor (encdoc) - start the browser UI (pure ASCII, CRLF).
rem Runs start-windows.ps1, which starts "node server.js --open".
pushd "%~dp0"
echo [start-windows.bat] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-windows.ps1" %*
set "RC=%ERRORLEVEL%"
echo [start-windows.bat] exit code: %RC%
popd
pause
exit /b %RC%
