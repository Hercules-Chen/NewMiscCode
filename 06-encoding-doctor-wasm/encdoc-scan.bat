@echo off
rem Encoding Doctor CLI launcher (pure ASCII, CRLF).
rem Usage: encdoc-scan.bat [folder] [--fix] [--apply] [--json] ...
rem Without arguments it asks for a folder (default: testdata) and runs a dry-run fix preview.
pushd "%~dp0"
echo [encdoc-scan.bat] folder: %CD%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0encdoc.ps1" %*
set "RC=%ERRORLEVEL%"
echo [encdoc-scan.bat] exit code: %RC% (0 = no errors, 1 = errors found, 2 = usage/IO error)
popd
pause
exit /b %RC%
