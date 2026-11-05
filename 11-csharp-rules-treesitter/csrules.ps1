# csrules.ps1 - C# 規則檢查器的 Windows 啟動腳本（由 .bat 呼叫：.bat -> csrules.ps1 -> node）
# 檔案編碼：UTF-8 with BOM（Windows PowerShell 5.1 需要 BOM 才能正確讀取中文）
# 刻意不用 param()，改用 $args，讓 --lang、--sarif 等參數原樣傳給 node。
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
        Write-Host '== npm ci（依 package-lock.json 安裝固定版本 / install pinned versions）==' -ForegroundColor Cyan
        & npm ci
        exit $LASTEXITCODE
    }
    'check' {
        if ($Rest.Count -eq 0) {
            Write-Host '用法 Usage: csrules.bat <C# 專案資料夾> [--html output\report.html] [--sarif output\report.sarif]' -ForegroundColor Yellow
            & node src/cli.js --help
            exit 2
        }
        & node src/cli.js @Rest
        exit $LASTEXITCODE
    }
    'sample' {
        Write-Host '== 掃描 samples\（刻意違規的範例，預期結束碼 1）==' -ForegroundColor Cyan
        & node src/cli.js samples --fix-suggestions --html output/report.html --sarif output/report.sarif --json output/report.json @Rest
        $code = $LASTEXITCODE
        $report = Join-Path $root 'output\report.html'
        if (Test-Path -LiteralPath $report) {
            Write-Host "HTML 報告 Report: $report"
            Start-Process $report
        }
        exit $code
    }
    'test' {
        & npm test
        exit $LASTEXITCODE
    }
    default {
        & node src/cli.js --help
        exit 0
    }
}
