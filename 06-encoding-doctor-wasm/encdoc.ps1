# 編碼醫生 CLI 包裝腳本 (UTF-8 with BOM)
# 用法: encdoc.ps1 [資料夾] [--fix] [--apply] [--json] [--debug] ...
#       不帶參數時會詢問要掃描的資料夾，並執行 --fix 預覽（不寫入）。
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
Set-Location -LiteralPath $PSScriptRoot
$exe = Join-Path $PSScriptRoot 'bin\encdoc.exe'
if (-not (Test-Path -LiteralPath $exe)) {
  Write-Host "[encdoc] 找不到 bin\encdoc.exe，嘗試建置 (需要 Go 1.24+ 與 Node)..." -ForegroundColor Yellow
  & node scripts/build.mjs --cli-only
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $exe)) {
    Write-Host "[encdoc] 建置失敗。請安裝 Go (https://go.dev/dl/) 後執行 build-windows.bat" -ForegroundColor Red
    exit 2
  }
}
$cliArgs = @($args)
if ($cliArgs.Count -eq 0) {
  $target = Read-Host "要掃描的資料夾 / folder to scan (Enter = testdata)"
  if ([string]::IsNullOrWhiteSpace($target)) { $target = Join-Path $PSScriptRoot 'testdata' }
  $cliArgs = @($target.Trim('"'), '--fix')
}
Write-Host "[encdoc] $exe $($cliArgs -join ' ')"
& $exe @cliArgs
exit $LASTEXITCODE
