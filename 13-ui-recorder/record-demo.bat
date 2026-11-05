@echo off
rem record-demo.bat - ASCII only, CRLF. Starts the 01 demo site and records it (headed).
rem Chain: .bat -> ui-recorder.ps1 -> node
setlocal
pushd "%~dp0"
echo [record-demo.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ui-recorder.ps1" demo %*
set "EXITCODE=%ERRORLEVEL%"
echo [record-demo.bat] exit code: %EXITCODE%  (0=saved, 2=error)
popd
if not defined UIREC_NO_PAUSE pause
exit /b %EXITCODE%
