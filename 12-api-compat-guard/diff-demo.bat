@echo off
rem diff-demo.bat - ASCII only, CRLF. Diffs demo/openapi-v1.yaml vs v2.
rem Chain: .bat -> apiguard.ps1 -> node
setlocal
pushd "%~dp0"
echo [diff-demo.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apiguard.ps1" diff-demo %*
set "EXITCODE=%ERRORLEVEL%"
echo [diff-demo.bat] exit code: %EXITCODE%  (0=compatible, 1=breaking changes, 2=error)
popd
if not defined APIGUARD_NO_PAUSE pause
exit /b %EXITCODE%
