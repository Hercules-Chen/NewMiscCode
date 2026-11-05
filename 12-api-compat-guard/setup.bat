@echo off
rem setup.bat - ASCII only, CRLF. Installs npm dependencies.
rem Chain: .bat -> apiguard.ps1 -> node
setlocal
pushd "%~dp0"
echo [setup.bat] project dir: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0apiguard.ps1" setup %*
set "EXITCODE=%ERRORLEVEL%"
echo [setup.bat] exit code: %EXITCODE%  (0=compatible, 1=breaking changes, 2=error)
popd
if not defined APIGUARD_NO_PAUSE pause
exit /b %EXITCODE%
