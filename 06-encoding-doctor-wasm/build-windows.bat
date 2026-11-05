@echo off
rem Encoding Doctor - build wasm + bin\encdoc.exe (pure ASCII, CRLF). Needs Go 1.24+ and Node 18+.
pushd "%~dp0"
echo [build-windows.bat] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1" %*
set "RC=%ERRORLEVEL%"
echo [build-windows.bat] exit code: %RC%
popd
pause
exit /b %RC%
