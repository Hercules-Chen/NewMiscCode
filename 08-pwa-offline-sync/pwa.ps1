# 08-pwa-offline-sync 啟動腳本（由 start.bat / dev.bat / run-tests.bat 呼叫）
# 用法: pwa.ps1 start|dev|test [其他參數會傳給 node src/cli.js]
param(
  [Parameter(Position = 0)][ValidateSet('start', 'dev', 'test')][string]$Mode = 'start',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath $PSScriptRoot
Write-Host "[pwa] 資料夾: $PSScriptRoot"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[pwa] 找不到 Node.js，請安裝 Node 22.13 以上版本: https://nodejs.org/' -ForegroundColor Red
  exit 1
}
$ver = (& node -p "process.versions.node").Trim()
$parts = $ver.Split('.') | ForEach-Object { [int]$_ }
if ($parts[0] -lt 22 -or ($parts[0] -eq 22 -and $parts[1] -lt 13)) {
  Write-Host "[pwa] Node $ver 太舊，需要 22.13 以上（內建 node:sqlite）" -ForegroundColor Red
  exit 1
}
Write-Host "[pwa] Node $ver"

switch ($Mode) {
  'test' {
    if (-not (Test-Path 'node_modules/playwright')) {
      Write-Host '[pwa] 安裝開發相依套件 (npm ci)...'
      & npm ci --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    }
    & npm test
    exit $LASTEXITCODE
  }
  default {
    $nodeArgs = @('--disable-warning=ExperimentalWarning', 'src/cli.js')
    if ($Mode -eq 'dev') { $nodeArgs += '--debug' }
    if ($Rest) { $nodeArgs += $Rest }
    Write-Host "[pwa] 瀏覽器開啟 http://localhost:8808/ （Ctrl+C 停止）"
    & node @nodeArgs
    exit $LASTEXITCODE
  }
}
