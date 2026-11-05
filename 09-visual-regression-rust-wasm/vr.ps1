# vr.ps1 - 視覺回歸工具（Rust + WebAssembly）的 Windows 啟動腳本（由 .bat 呼叫：.bat -> vr.ps1 -> node）
# 檔案編碼：UTF-8 with BOM（Windows PowerShell 5.1 需要 BOM 才能正確讀取中文）
# 用法：vr.ps1 <command> [args...]
#   setup   安裝 Playwright（npm install）與 Chromium（npx playwright install chromium）
#   test    執行 npm test（node --test）
#   demo    v1 -> approve -> v2 示範，產生報告
#   serve   啟動瀏覽器 UI（http://127.0.0.1:5179/）
#   build   重新建置 wasm 與原生 CLI（需要 Rust：rustup target add wasm32-unknown-unknown）
#   其他    直接轉給 node src/cli.js（compare / run / approve / bench）
# Note: uses $args (not param()) so flags like --threshold pass through unchanged.
$Command = if ($args.Count -gt 0) { [string]$args[0] } else { 'help' }
$Rest = @()
if ($args.Count -gt 1) { $Rest = @($args[1..($args.Count - 1)]) }
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Here
Write-Host "[vr.ps1] 專案資料夾 / project dir: $Here"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[vr.ps1] 找不到 Node.js（需要 20 以上）。請從 https://nodejs.org 安裝後重試。 / Node.js not found.' -ForegroundColor Red
  exit 2
}
Write-Host ("[vr.ps1] node " + (& node --version))

switch ($Command) {
  'setup' {
    & npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & npx playwright install chromium
    exit $LASTEXITCODE
  }
  'test' {
    & node --test --test-concurrency=1 "test/*.test.mjs"
    exit $LASTEXITCODE
  }
  'demo' {
    & node scripts/demo.mjs @Rest
    exit $LASTEXITCODE
  }
  'build' {
    & node scripts/build-wasm.mjs
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & cargo build --release -j 2 --manifest-path crate/Cargo.toml
    exit $LASTEXITCODE
  }
  default {
    & node src/cli.js $Command @Rest
    exit $LASTEXITCODE
  }
}
