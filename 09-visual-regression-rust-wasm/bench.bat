@echo off
rem bench.bat - ASCII only. WASM vs native timing (needs native build).
rem Chain: bench.bat -> vr.ps1 -> node
setlocal
pushd "%~dp0"
echo [bench] current dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0vr.ps1" bench %*
set "EXITCODE=%ERRORLEVEL%"
echo [bench] exit code: %EXITCODE%
popd
pause
exit /b %EXITCODE%
