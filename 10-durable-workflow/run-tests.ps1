# 執行 npm test（引擎語意、崩潰復原、Playwright 儀表板測試）。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host '找不到 node，請先安裝 Node.js 22 以上版本 (https://nodejs.org/)' -ForegroundColor Red; exit 9009 }
$ver = (& node -v)
Write-Host "Node: $($node.Source) $ver"
if ([int](($ver -replace '^v','').Split('.')[0]) -lt 22) { Write-Host '需要 Node.js 22.5 以上 (node:sqlite)' -ForegroundColor Red; exit 1 }

& npm test
exit $LASTEXITCODE
