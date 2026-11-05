# apiguard.ps1 - API 相容性守門員 Windows 啟動腳本（由 .bat 呼叫：.bat -> apiguard.ps1 -> node）
# 檔案編碼：UTF-8 with BOM（Windows PowerShell 5.1 需要 BOM 才能正確讀取中文）
# 刻意不用 param()，改用 $args，讓 --lang、--header 等參數原樣傳給 node。
$Command = if ($args.Count -gt 0) { [string]$args[0] } else { 'help' }
$Rest = @()
if ($args.Count -gt 1) { $Rest = @($args[1..($args.Count - 1)]) }
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$root = $PSScriptRoot
Set-Location -LiteralPath $root
Write-Host "專案資料夾 Project dir: $root"
$dataDir = if ($env:APIGUARD_DATA_DIR) { $env:APIGUARD_DATA_DIR } else { Join-Path $env:ProgramData 'NewMiscCode\12-api-compat-guard' }
Write-Host "資料/日誌資料夾 Data/log dir: $dataDir"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host '找不到 node，請先安裝 Node.js 20 以上版本（https://nodejs.org/）。 Node.js not found.' -ForegroundColor Red
    exit 9009
}
Write-Host ('Node ' + (& node --version) + ' : ' + $node.Source)

if ($Command -ne 'setup' -and -not (Test-Path -LiteralPath (Join-Path $root 'node_modules\yaml'))) {
    Write-Host '尚未安裝相依套件，請先執行 setup.bat。 Dependencies missing: run setup.bat first.' -ForegroundColor Yellow
    exit 3
}

switch ($Command) {
    'setup' {
        Write-Host '== npm install ==' -ForegroundColor Cyan
        & npm install
        exit $LASTEXITCODE
    }
    'test' {
        & npm test
        exit $LASTEXITCODE
    }
    'demo' {
        & node scripts/demo.js @Rest
        exit $LASTEXITCODE
    }
    'diff-demo' {
        & node src/cli.js diff demo/openapi-v1.yaml demo/openapi-v2.yaml --format html @Rest
        exit $LASTEXITCODE
    }
    'cli' {
        & node src/cli.js @Rest
        exit $LASTEXITCODE
    }
    default {
        & node src/cli.js help
        exit 2
    }
}
