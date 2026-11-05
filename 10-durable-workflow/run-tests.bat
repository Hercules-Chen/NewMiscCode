@echo off
rem Durable Workflow: npm test - pure ASCII launcher; real work is done in run-tests.ps1 (UTF-8 with BOM).
pushd "%~dp0"
echo [run-tests.bat] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-tests.ps1" %*
set "RC=%ERRORLEVEL%"
echo [run-tests.bat] exit code: %RC%
popd
if not "%WF_NOPAUSE%"=="1" pause
exit /b %RC%
