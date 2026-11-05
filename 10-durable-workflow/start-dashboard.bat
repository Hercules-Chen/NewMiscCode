@echo off
rem Durable Workflow: dashboard + REST API + embedded worker - pure ASCII launcher; real work is done in start-dashboard.ps1 (UTF-8 with BOM).
pushd "%~dp0"
echo [start-dashboard.bat] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dashboard.ps1" %*
set "RC=%ERRORLEVEL%"
echo [start-dashboard.bat] exit code: %RC%
popd
if not "%WF_NOPAUSE%"=="1" pause
exit /b %RC%
