# ui-recorder.ps1 - UI 錄製器 Windows 啟動腳本（由 .bat 呼叫：.bat -> ui-recorder.ps1 -> node）
# 檔案編碼：UTF-8 with BOM（Windows PowerShell 5.1 需要 BOM 才能正確讀取中文）
# 刻意不用 param()，改用 $args，讓 --lang、--out 等參數原樣傳給 node。
$Command = if ($args.Count -gt 0) { [string]$args[0] } else { 'help' }
$Rest = @()
if ($args.Count -gt 1) { $Rest = @($args[1..($args.Count - 1)]) }
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = $PSScriptRoot
Set-Location -LiteralPath $root
Write-Host "專案資料夾 Project dir: $root"
$dataDir = if ($env:UIREC_OUTPUT_DIR) { $env:UIREC_OUTPUT_DIR } else { Join-Path $env:ProgramData 'NewMiscCode\13-ui-recorder' }
Write-Host "輸出/日誌資料夾 Output/log dir: $dataDir"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host '找不到 node，請先安裝 Node.js 20 以上版本（https://nodejs.org/）。 Node.js not found.' -ForegroundColor Red
    exit 9009
}
Write-Host ('Node ' + (& node --version) + ' : ' + $node.Source)

# Playwright：全域安裝或 01-mcp-ui-verifier\node_modules 其中之一即可。
& node -e "import('./src/config.js').then(m => { m.loadPlaywright(); console.log('Playwright OK'); }).catch(e => { console.error(e.message); process.exit(3); })"
if ($LASTEXITCODE -ne 0) {
    Write-Host '找不到 Playwright：請執行 npm i -g playwright 並 npx playwright install chromium，或先執行 ..\01-mcp-ui-verifier\setup.bat。 Playwright not found.' -ForegroundColor Yellow
    if ($Command -ne 'setup') { exit 3 }
}

switch ($Command) {
    'setup' {
        Write-Host '本專案沒有 npm 相依套件；Playwright 使用全域安裝或 01-mcp-ui-verifier 的版本。 No npm dependencies.' -ForegroundColor Cyan
        exit 0
    }
    'test' {
        & npm test
        exit $LASTEXITCODE
    }
    'demo' {
        & node scripts/record-demo.js @Rest
        exit $LASTEXITCODE
    }
    'record' {
        & node src/cli.js record @Rest
        exit $LASTEXITCODE
    }
    default {
        & node src/cli.js --help
        exit 2
    }
}
