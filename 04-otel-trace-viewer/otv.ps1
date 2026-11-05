# otv.ps1 - 04-otel-trace-viewer 的 Windows 啟動腳本（由 .bat 呼叫：.bat -> otv.ps1 -> node）
# 檔案編碼：UTF-8 with BOM（Windows PowerShell 5.1 需要 BOM 才能正確讀取中文）
# 刻意不用 param() 區塊，改用 $args，讓 --debug、--load 這類參數原樣傳給 node。
# Usage: otv.ps1 <setup|start|loadgen|collector|test> [node options...]
$Command = if ($args.Count -gt 0) { [string]$args[0] } else { 'help' }
$Rest = @()
if ($args.Count -gt 1) { $Rest = @($args[1..($args.Count - 1)]) }
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = $PSScriptRoot
Set-Location -LiteralPath $root
Write-Host "專案資料夾 Project dir: $root"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host '找不到 node，請先安裝 Node.js 22.13 以上版本（https://nodejs.org/）。 Node.js not found.' -ForegroundColor Red
    exit 9009
}
Write-Host ('Node ' + (& node --version) + ' : ' + $node.Source)

if ($Command -ne 'setup' -and $Command -ne 'help' -and -not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    Write-Host '尚未安裝相依套件，請先執行 setup.bat。 Dependencies missing: run setup.bat first.' -ForegroundColor Yellow
    exit 3
}

$nodeFlags = @('--disable-warning=ExperimentalWarning')
switch ($Command) {
    'setup' {
        Write-Host '== npm ci（依 package-lock.json 安裝 / install from lockfile）==' -ForegroundColor Cyan
        & npm ci
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Host '== npx playwright install chromium（只有 npm test 需要 / only needed for npm test）==' -ForegroundColor Cyan
        & npx playwright install chromium
        exit $LASTEXITCODE
    }
    'start' {
        Write-Host '啟動 collector + gateway + orders + pricing；瀏覽器開啟 http://127.0.0.1:4318/  （Ctrl+C 結束）' -ForegroundColor Cyan
        & node @nodeFlags src/start-all.mjs @Rest
        exit $LASTEXITCODE
    }
    'loadgen' {
        & node src/loadgen.mjs @Rest
        exit $LASTEXITCODE
    }
    'collector' {
        & node @nodeFlags src/collector/server.mjs @Rest
        exit $LASTEXITCODE
    }
    'test' {
        & node @nodeFlags --test --test-concurrency=1 test/e2e.test.mjs
        exit $LASTEXITCODE
    }
    default {
        Write-Host '用法 Usage: otv.ps1 <setup|start|loadgen|collector|test> [options]'
        Write-Host '  start   --debug --load 30 --data-dir D:\otv-data --collector-port 4318'
        Write-Host '  loadgen --gateway http://127.0.0.1:3401 --count 50 --concurrency 4'
        exit 0
    }
}
