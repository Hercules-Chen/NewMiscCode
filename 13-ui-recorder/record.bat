@echo off
rem record.bat - ASCII only, CRLF. Usage: record.bat http://127.0.0.1:4173/ --out my.json
rem Chain: .bat -> ui-recorder.ps1 -> node
setlocal
pushd "%~dp0"
echo [record.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ui-recorder.ps1" record %*
set "EXITCODE=%ERRORLEVEL%"
echo [record.bat] exit code: %EXITCODE%  (0=saved, 2=error)
popd
if not defined UIREC_NO_PAUSE pause
exit /b %EXITCODE%
