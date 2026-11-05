@echo off
rem lss.bat - ASCII only. Wrapper: .bat -> lss.ps1 -> node src\cli.js
setlocal
pushd "%~dp0"
echo [lss] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lss.ps1" %*
set "RC=%ERRORLEVEL%"
echo [lss] exit code: %RC%
popd
pause
exit /b %RC%
