# passkeys.ps1 - 啟動器 / launcher. 由 start.bat / start-debug.bat / run-tests.bat 呼叫，也可直接執行：
#   .\passkeys.ps1 --debug            啟動伺服器（除錯模式）/ start server in debug mode
#   .\passkeys.ps1 -Test              執行 npm test / run tests
# 存成 UTF-8 WITH BOM，Windows PowerShell 5.1 才能正確讀取中文。Saved as UTF-8 with BOM for PowerShell 5.1.
param(
  [switch]$Test,
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
Write-Host "[passkeys] 專案資料夾 / project: $here"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[passkeys] 找不到 node。請安裝 Node 22（建議 Volta: volta install node@22）/ node.exe not found on PATH'
  exit 9009
}
$ver = & node -p "process.versions.node"
Write-Host "[passkeys] node $ver ($($node.Source))"
if (-not $ver.StartsWith('22.')) {
  Write-Host '[passkeys] 警告：建議使用 Node 22。若出現 NODE_MODULE_VERSION 錯誤請執行 npm rebuild better-sqlite3 / warning: Node 22 recommended'
}
if (-not (Test-Path (Join-Path $here 'node_modules'))) {
  Write-Host '[passkeys] 首次執行：npm ci / first run: installing dependencies'
  & npm ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if (-not (Test-Path (Join-Path $here 'public\build\app.js'))) {
  Write-Host '[passkeys] 建置前端 bundle / building client bundle'
  & node (Join-Path $here 'scripts\build-client.js')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if ($Test) {
  & npm test
  exit $LASTEXITCODE
}
$dataDir = Join-Path $env:ProgramData 'NewMiscCode\07-passkeys-webauthn'
Write-Host "[passkeys] 資料與日誌 / data + logs: $dataDir（可用 --data-dir 變更）"
Write-Host '[passkeys] 請用 http://localhost:3007 開啟（不要用 127.0.0.1，rpID 為 localhost）/ open http://localhost:3007'
& node (Join-Path $here 'src\cli.js') @CliArgs
exit $LASTEXITCODE
