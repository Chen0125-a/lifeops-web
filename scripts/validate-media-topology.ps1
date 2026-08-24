param(
  [Parameter(Mandatory = $true)]
  [string]$ValuesFile,
  [string]$HelmExecutable = 'helm'
)

$ErrorActionPreference = 'Stop'
$chart = Join-Path (Split-Path -Parent $PSScriptRoot) 'deploy/helm/lifeops-web'
& $HelmExecutable template lifeops $chart --values $ValuesFile | Out-Null
exit $LASTEXITCODE
