@echo off
rem index.bat - ASCII only. Wrapper: .bat -> lss.ps1 -> node src\cli.js
setlocal
pushd "%~dp0"
echo [lss] folder: %CD%
echo [lss] step 1/2: preview (dry-run, nothing is written)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lss.ps1" index --dry-run %*
if errorlevel 1 goto :done
choice /C YN /M "Write the index now"
if errorlevel 2 (
  echo [lss] skipped, nothing written
  ver > nul
  goto :done
)
echo [lss] step 2/2: indexing
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0lss.ps1" index %*
:done
set "RC=%ERRORLEVEL%"
echo [lss] exit code: %RC%
popd
pause
exit /b %RC%
