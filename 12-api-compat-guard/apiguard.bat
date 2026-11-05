@echo off
rem apiguard.bat - ASCII only, CRLF. Generic CLI: apiguard.bat diff old.yaml new.yaml
rem Chain: .bat -> apiguard.ps1 -> node
setlocal
pushd "%~dp0"
echo [apiguard.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apiguard.ps1" cli %*
set "EXITCODE=%ERRORLEVEL%"
echo [apiguard.bat] exit code: %EXITCODE%  (0=compatible, 1=breaking changes, 2=error)
popd
if not defined APIGUARD_NO_PAUSE pause
exit /b %EXITCODE%
