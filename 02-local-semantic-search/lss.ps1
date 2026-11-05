# lss.ps1 - 啟動器 / launcher. 由 .bat 呼叫，也可直接執行: .\lss.ps1 search 欄位加密
# Saved as UTF-8 WITH BOM so Windows PowerShell 5.1 reads the Chinese text correctly.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$CliArgs)
$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $here
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Write-Host '[lss] 找不到 node。請安裝 Node 22（建議 Volta: volta install node@22）/ node.exe not found on PATH'
  exit 9009
}
$ver = & node -p "process.versions.node"
Write-Host "[lss] node $ver ($($node.Source))"
if (-not $ver.StartsWith('22.')) {
  Write-Host '[lss] 警告：建議使用 Node 22（package.json volta 已固定）。若出現 NODE_MODULE_VERSION 錯誤請執行 npm rebuild / warning: Node 22 recommended'
}
if (-not (Test-Path (Join-Path $here 'node_modules'))) {
  Write-Host '[lss] 首次執行：npm ci / first run: installing dependencies'
  & npm ci
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$model = Join-Path $here 'models\Xenova\multilingual-e5-small\onnx\model_quantized.onnx'
if (-not (Test-Path $model) -and ($CliArgs -notcontains 'hash')) {
  Write-Host '[lss] 尚未下載模型，執行 npm run fetch-model（或加 --embedder hash 使用離線備援）/ model missing'
}
& node (Join-Path $here 'src\cli.js') @CliArgs
exit $LASTEXITCODE
