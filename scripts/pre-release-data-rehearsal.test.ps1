param()

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'pre-release-data-rehearsal.ps1'
$failures = [Collections.Generic.List[string]]::new()
function Require([bool]$Condition, [string]$Message) { if (!$Condition) { $script:failures.Add($Message) } }

Require (Test-Path -LiteralPath $scriptPath -PathType Leaf) 'Data rehearsal script must be loadable.'
$source = Get-Content -LiteralPath $scriptPath -Raw
foreach ($token in @('mysql:8.4.10', 'mysqldump', 'lifeops-rehearsal-source-', 'lifeops-rehearsal-target-', 'sentinel', 'checksum', 'finally', 'docker rm')) {
  Require ($source -match [regex]::Escape($token)) "Data rehearsal contract is missing token: $token"
}
foreach ($token in @('LIFEOPS_ADMIN_ACCOUNT', 'LIFEOPS_ADMIN_PASSWORD', 'MYSQL_PWD')) {
  Require ($source -match [regex]::Escape($token)) "Disposable migration configuration is missing token: $token"
}
Require ($source -notmatch '-p(?:assword)?[=]?\s*[''\"]?\$MYSQL_ROOT_PASSWORD') 'Container MySQL commands must not expose the password as a command-line argument.'
Require ($source -notmatch 'mysql[^\r\n]+\s-e\s') 'SQL probes must use copied files instead of nested shell -e quoting on Windows.'
Require ($source -notmatch '(?i)kubectl|kubeconfig|helm\s+(?:install|upgrade)|argo\s+(?:sync|rollback)') 'Data rehearsal must not inspect or mutate a cluster.'

$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -MySqlImage mysql:latest 2>&1 | Out-String
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $previous
Require ($exitCode -ne 0) 'A mutable MySQL image must be rejected before Docker is touched.'
Require ($output -match 'IMMUTABLE_MYSQL_IMAGE_REQUIRED') 'Mutable-image failure must use the stable machine-readable code.'

if ($failures.Count -gt 0) { throw ("data-rehearsal-contract failed:`n- " + ($failures -join "`n- ")) }
Write-Output 'data-rehearsal-contract: ok'
