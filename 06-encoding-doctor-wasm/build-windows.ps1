# 編碼醫生 - 建置腳本 (UTF-8 with BOM)
# 產生 web\encdoc.wasm、web\wasm_exec.js、bin\encdoc.exe；可加 -Test 執行全部測試。
param([switch]$Test)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Set-Location -LiteralPath $PSScriptRoot
foreach ($tool in 'go', 'node') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    Write-Host "[build] 找不到 $tool。Go: https://go.dev/dl/  Node: https://nodejs.org/" -ForegroundColor Red
    exit 2
  }
}
Write-Host "[build] $(& go version)"
& node scripts/build.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($Test) {
  & node scripts/go.mjs test ./...
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & node test/cli.mjs
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
Write-Host "[build] 完成 / done" -ForegroundColor Green
exit 0
