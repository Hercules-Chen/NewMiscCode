# DuckDB-WASM 資料分析台 - Windows 啟動腳本 (UTF-8 with BOM)
# 用法: start-windows.ps1 [-Port 8703] [-LogDir <dir>] [-NoBrowser]
param(
  [int]$Port = 8703,
  [string]$LogDir = "",
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Set-Location -LiteralPath $PSScriptRoot
Write-Host "[start] 資料夾 / folder: $PSScriptRoot"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host "[start] 找不到 Node.js，請先安裝 Node 18 以上版本 (https://nodejs.org/)" -ForegroundColor Red
  Write-Host "[start] Node.js not found. Please install Node 18+." -ForegroundColor Red
  exit 2
}
Write-Host "[start] node: $($node.Source) $(& node --version)"

if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'public\vendor\duckdb-eh.wasm'))) {
  Write-Host "[start] 第一次執行：安裝相依套件並建置 (npm install && npm run build)..." -ForegroundColor Yellow
  & npm install
  if ($LASTEXITCODE -ne 0) { Write-Host "[start] npm install 失敗 / failed ($LASTEXITCODE)" -ForegroundColor Red; exit $LASTEXITCODE }
  & npm run build
  if ($LASTEXITCODE -ne 0) { Write-Host "[start] npm run build 失敗 / failed ($LASTEXITCODE)" -ForegroundColor Red; exit $LASTEXITCODE }
}

$serverArgs = @('server.js', '--port', "$Port")
if ($LogDir) { $serverArgs += @('--log-dir', $LogDir) }
if (-not $NoBrowser) { $serverArgs += '--open' }
$url = "http://127.0.0.1:$Port/"
Write-Host "[start] 網址 / URL: $url   (除錯模式 / debug: ${url}?debug=1)" -ForegroundColor Green
Write-Host "[start] 按 Ctrl+C 停止伺服器 / Press Ctrl+C to stop."
& node @serverArgs
$rc = $LASTEXITCODE
Write-Host "[start] 伺服器結束 / server exited, code $rc"
exit $rc
