# wf 命令列：wf.bat start leave-approval / wf.bat status / wf.bat worker ...
# JSON 參數在 PowerShell 中建議用檔案：wf.bat start order-saga --input-file examples\order-input.json
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location -LiteralPath $PSScriptRoot
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Write-Host '找不到 node，請先安裝 Node.js 22 以上版本 (https://nodejs.org/)' -ForegroundColor Red; exit 9009 }
$ver = (& node -v)
Write-Host "Node: $($node.Source) $ver"
if ([int](($ver -replace '^v','').Split('.')[0]) -lt 22) { Write-Host '需要 Node.js 22.5 以上 (node:sqlite)' -ForegroundColor Red; exit 1 }

& node bin/wf.mjs @args
exit $LASTEXITCODE
