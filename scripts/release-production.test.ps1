param()

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'release-production.ps1'
$failures = [Collections.Generic.List[string]]::new()
function Require([bool]$Condition, [string]$Message) { if (!$Condition) { $script:failures.Add($Message) } }

Require (Test-Path -LiteralPath $scriptPath -PathType Leaf) 'Release production script must be loadable.'
$source = Get-Content -LiteralPath $scriptPath -Raw
foreach ($token in @('Version', 'Workflow', 'Wait', 'gh workflow run', 'gh run watch', 'sha256:', 'imagetools inspect', 'release-manifest.json', 'sourceRevision', 'sbom', 'provenance')) {
  Require ($source -match [regex]::Escape($token)) "Release production contract is missing token: $token"
}
Require ($source -notmatch '(?i)kubectl|kubeconfig|helm\s+(?:install|upgrade)|argo\s+(?:sync|rollback)') 'Release production must never operate a cluster.'

$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Version latest 2>&1 | Out-String
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $previous
Require ($exitCode -ne 0) 'A non-SemVer release version must fail before external dispatch.'
Require ($output -match 'INVALID_SEMVER') 'Invalid version failure must use the stable machine-readable code.'

if ($failures.Count -gt 0) { throw ("release-production-contract failed:`n- " + ($failures -join "`n- ")) }
Write-Output 'release-production-contract: ok'

