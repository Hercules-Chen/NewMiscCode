# 編碼醫生 - 瀏覽器介面啟動腳本 (UTF-8 with BOM)
# 用法: start-windows.ps1 [-Port 8706] [-LogDir <dir>] [-NoBrowser]
param(
  [int]$Port = 8706,
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

$wasm = Join-Path $PSScriptRoot 'web\encdoc.wasm'
$exec = Join-Path $PSScriptRoot 'web\wasm_exec.js'
if (-not (Test-Path -LiteralPath $wasm) -or -not (Test-Path -LiteralPath $exec)) {
  Write-Host "[start] 缺少 web\encdoc.wasm，嘗試建置 (需要 Go 1.24+)..." -ForegroundColor Yellow
  & node scripts/build.mjs --wasm-only
  if ($LASTEXITCODE -ne 0) { Write-Host "[start] 建置失敗 / build failed ($LASTEXITCODE)。請安裝 Go: https://go.dev/dl/" -ForegroundColor Red; exit $LASTEXITCODE }
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
