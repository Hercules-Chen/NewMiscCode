# uiv.ps1 - mcp-ui-verifier 的 Windows 啟動腳本（由 .bat 呼叫：.bat -> uiv.ps1 -> node）
# 檔案編碼：UTF-8 with BOM（Windows PowerShell 5.1 需要 BOM 才能正確讀取中文）
# 注意：刻意不用 param() 區塊，改用 $args，讓 --lang、--base-url 這類參數原樣傳給 node。
# Note: $args (not param()) so that --lang / --base-url etc. pass through to node unchanged.
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
    Write-Host '找不到 node，請先安裝 Node.js 20 以上版本（https://nodejs.org/）。 Node.js not found.' -ForegroundColor Red
    exit 9009
}
Write-Host ('Node ' + (& node --version) + ' : ' + $node.Source)

if ($Command -ne 'setup' -and -not (Test-Path -LiteralPath (Join-Path $root 'node_modules'))) {
    Write-Host '尚未安裝相依套件，請先執行 setup.bat。 Dependencies missing: run setup.bat first.' -ForegroundColor Yellow
    exit 3
}

switch ($Command) {
    'setup' {
        Write-Host '== npm install ==' -ForegroundColor Cyan
        & npm install
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        Write-Host '== npx playwright install chromium（下載瀏覽器 / download browser）==' -ForegroundColor Cyan
        & npx playwright install chromium
        exit $LASTEXITCODE
    }
    'demo' {
        & node src/cli.js demo @Rest
        exit $LASTEXITCODE
    }
    'run' {
        if ($Rest.Count -eq 0) {
            Write-Host '用法：run-scenario.bat <scenario.json> [選項]   Usage: run-scenario.bat <scenario.json> [options]' -ForegroundColor Yellow
            Write-Host '範例 Example: run-scenario.bat scenarios\demo-pass.json --base-url http://127.0.0.1:4173/'
            exit 2
        }
        & node src/cli.js run @Rest
        exit $LASTEXITCODE
    }
    'serve-demo' {
        & node src/cli.js serve-demo @Rest
        exit $LASTEXITCODE
    }
    'test' {
        & node --test
        exit $LASTEXITCODE
    }
    default {
        & node src/cli.js --help
        exit 0
    }
}
