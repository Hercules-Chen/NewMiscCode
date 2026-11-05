@echo off
rem Run all project tests. ASCII only.
setlocal
pushd "%~dp0"
echo [verify-all.bat] dir=%CD%
node -e "console.log('node-ok ' + process.version)"
if errorlevel 1 (
  echo [verify-all.bat] node.exe not found or crashed. errorlevel=%errorlevel%
  goto :end
)
node tools\verify-all.mjs %*
:end
set RC=%errorlevel%
echo [verify-all.bat] exit code=%RC%
popd
pause
exit /b %RC%
