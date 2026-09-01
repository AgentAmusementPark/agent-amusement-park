$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    & $nodeCommand.Source "$PSScriptRoot\server.js"
    exit $LASTEXITCODE
}

$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (Test-Path -LiteralPath $bundledNode) {
    & $bundledNode "$PSScriptRoot\server.js"
    exit $LASTEXITCODE
}

Write-Error "Node.js 18+ was not found. Install Node.js or run this inside Codex with its bundled runtime."
exit 1
