@echo off
rem run-tests.bat - ASCII only. Runs unit + e2e tests (npm test) through passkeys.ps1.
setlocal
pushd "%~dp0"
echo [passkeys] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0passkeys.ps1" -Test
set "RC=%ERRORLEVEL%"
echo [passkeys] exit code: %RC%
popd
pause
exit /b %RC%
