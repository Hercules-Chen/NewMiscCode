@echo off
rem Durable Workflow CLI (wf start / signal / status / worker ...) - pure ASCII launcher; real work is done in wf.ps1 (UTF-8 with BOM).
pushd "%~dp0"
echo [wf.bat] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0wf.ps1" %*
set "RC=%ERRORLEVEL%"
echo [wf.bat] exit code: %RC%
popd
if not "%WF_NOPAUSE%"=="1" pause
exit /b %RC%
