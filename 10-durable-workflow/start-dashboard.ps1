# 啟動儀表板 + REST API + 內嵌 worker。參數會原樣傳給 "wf serve"，例如：
#   start-dashboard.bat --port 9000 --debug
#   start-dashboard.bat --no-worker (只開儀表板，worker 另外用 wf.bat worker 啟動)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host '找不到 node，請先安裝 Node.js 22 以上版本 (https://nodejs.org/)' -ForegroundColor Red; exit 9009 }
$ver = (& node -v)
Write-Host "Node: $($node.Source) $ver"
if ([int](($ver -replace '^v','').Split('.')[0]) -lt 22) { Write-Host '需要 Node.js 22.5 以上 (node:sqlite)' -ForegroundColor Red; exit 1 }

$dataRoot = if ($env:WF_DATA_DIR) { $env:WF_DATA_DIR } else { Join-Path $env:ProgramData 'NewMiscCode\10-durable-workflow\data' }
Write-Host "資料夾 (SQLite): $dataRoot"
Write-Host '啟動中... 關閉此視窗或按 Ctrl+C 即停止。'
& node bin/wf.mjs serve --open @args
exit $LASTEXITCODE
