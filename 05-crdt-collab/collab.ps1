# collab.ps1 - 05-crdt-collab 啟動腳本（由 run-*.bat 呼叫，也可直接執行）
# 用法: powershell -ExecutionPolicy Bypass -File collab.ps1 <start|debug|test|build> [伺服器參數...]
#   start  建置（必要時）並啟動伺服器，開啟瀏覽器
#   debug  同 start，但伺服器以 --debug 輸出詳細日誌
#   test   npm test（Playwright 端對端 + Node 單元測試）
#   build  只重新建置前端 bundle
param(
  [Parameter(Position = 0)][ValidateSet('start', 'debug', 'test', 'build')][string]$Mode = 'start',
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
Set-Location -LiteralPath $PSScriptRoot
Write-Host "[collab] 專案資料夾: $PSScriptRoot"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[collab] 找不到 node。請先安裝 Node.js 20 以上版本 (https://nodejs.org/)。' -ForegroundColor Red
  exit 1
}
$ver = (& node -p "process.versions.node").Trim()
Write-Host "[collab] Node.js $ver ($($node.Source))"
if ([int]($ver.Split('.')[0]) -lt 20) {
  Write-Host '[collab] 需要 Node.js 20 以上版本。' -ForegroundColor Red
  exit 1
}

function Invoke-Step([string]$label, [scriptblock]$block) {
  Write-Host "[collab] $label"
  & $block
  if ($LASTEXITCODE -ne 0) { Write-Host "[collab] 失敗: $label (exit $LASTEXITCODE)" -ForegroundColor Red; exit $LASTEXITCODE }
}

if (-not (Test-Path -LiteralPath 'node_modules')) {
  Invoke-Step '安裝相依套件 (npm ci)...' { npm ci }
}
if ($Mode -eq 'build' -or -not (Test-Path -LiteralPath 'public\dist\app.js')) {
  Invoke-Step '建置前端 (npm run build)...' { npm run build }
  if ($Mode -eq 'build') { exit 0 }
}

switch ($Mode) {
  'test' {
    Write-Host '[collab] 確認 Playwright Chromium 已安裝 (首次需下載)...'
    & npx playwright install chromium
    Invoke-Step '執行測試 (npm test)...' { npm test }
    exit 0
  }
  default {
    $serverArgs = @('src\server\index.js', '--open')
    if ($Mode -eq 'debug') { $serverArgs += '--debug' }
    if ($Rest) { $serverArgs += $Rest }
    Write-Host "[collab] 啟動: node $($serverArgs -join ' ')"
    Write-Host '[collab] 資料與日誌預設位置: %ProgramData%\NewMiscCode\05-crdt-collab  (按 Ctrl+C 停止)'
    & node @serverArgs
    exit $LASTEXITCODE
  }
}
