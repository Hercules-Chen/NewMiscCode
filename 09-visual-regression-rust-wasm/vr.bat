@echo off
rem vr.bat - ASCII only. Generic: vr.bat compare a.png b.png --out diff.png
rem Chain: vr.bat -> vr.ps1 -> node
setlocal
pushd "%~dp0"
echo [vr] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vr.ps1" %*
set "EXITCODE=%ERRORLEVEL%"
echo [vr] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
