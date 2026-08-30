[CmdletBinding()]
param(
  [string]$ReleaseManifest = 'outputs/final/release-manifest.json',
  [string]$ValuesFile = 'deploy/gitops/environments/production/values.yaml',
  [string]$ChecklistPath = 'docs/runbooks/user-deployment-checklist.md',
  [string]$RollbackPath = 'docs/runbooks/deploy-rollback.md',
  [string]$SummaryPath = 'outputs/final/deployment-package-summary.md',
  [string]$HelmExecutable = ''
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot

function Fail([string]$Code) { throw $Code }
function Resolve-WorkspacePath([string]$PathValue) {
  $candidate = if ([IO.Path]::IsPathRooted($PathValue)) { $PathValue } else { Join-Path $workspace $PathValue }
  return [IO.Path]::GetFullPath($candidate)
}
function Require-File([string]$PathValue) {
  $resolved = Resolve-WorkspacePath $PathValue
  if (!(Test-Path -LiteralPath $resolved -PathType Leaf)) { Fail 'DEPLOYMENT_PACKAGE_FILE_MISSING' }
  return $resolved
}
function Resolve-Helm {
  if ($HelmExecutable) { return $HelmExecutable }
  $command = Get-Command helm -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $packages = Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages'
  $candidate = Get-ChildItem -LiteralPath $packages -Recurse -Filter helm.exe -File -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (!$candidate) { Fail 'DEPLOYMENT_PACKAGE_HELM_MISSING' }
  return $candidate
}
function Invoke-CheckedPowerShell([string]$Script, [string[]]$Arguments, [string]$FailureCode) {
  $prior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script @Arguments 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $prior
  if ($exitCode -ne 0) {
    if ($output -match '(?i)/metrics.*HTTPRoute|HTTPRoute.*metrics') { Fail 'DEPLOYMENT_PACKAGE_PUBLIC_METRICS' }
    if ($output -match '(?i)ClusterRole|RBAC|wildcard|pods/log|pods/exec') { Fail 'DEPLOYMENT_PACKAGE_RBAC' }
    Fail $FailureCode
  }
}

$manifestPath = Require-File $ReleaseManifest
$valuesPath = Require-File $ValuesFile
$checklist = Require-File $ChecklistPath
$rollback = Require-File $RollbackPath
$requiredFiles = @(
  'deploy/helm/lifeops-web/Chart.yaml',
  'deploy/helm/lifeops-web/values.yaml',
  'deploy/helm/lifeops-web/values.schema.json',
  'deploy/argocd/application.example.yaml',
  'scripts/post-deploy-smoke.ps1',
  'tests/deployment-smoke.spec.ts',
  'tests/deployment-persistence.spec.ts'
)
foreach ($required in $requiredFiles) { $null = Require-File $required }

$manifest = try { Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json } catch { Fail 'DEPLOYMENT_PACKAGE_RELEASE_MANIFEST_INVALID' }
$digestPattern = '^sha256:[a-f0-9]{64}$'
foreach ($imageName in @('web', 'api')) {
  $image = $manifest.images.$imageName
  if (!$image -or $image.digest -notmatch $digestPattern -or $image.immutableReference -notmatch "@$([regex]::Escape($image.digest))$") {
    Fail 'DEPLOYMENT_PACKAGE_RELEASE_MANIFEST_INVALID'
  }
  if (!$image.sbom.verified -or !$image.provenance.verified -or $image.sbom.digest -ne $image.digest -or $image.provenance.digest -ne $image.digest) {
    Fail 'DEPLOYMENT_PACKAGE_RELEASE_MANIFEST_INVALID'
  }
}
if ($manifest.sourceRevision -notmatch '^[a-f0-9]{40}$' -or $manifest.testCheckpoint -notmatch '^[A-F0-9]{64}$') {
  Fail 'DEPLOYMENT_PACKAGE_RELEASE_MANIFEST_INVALID'
}

$releaseVerifier = Require-File 'scripts/verify-release-manifest.ps1'
Invoke-CheckedPowerShell $releaseVerifier @('-Manifest', $manifestPath, '-ArtifactOnly') 'DEPLOYMENT_PACKAGE_RELEASE_MANIFEST_INVALID'

$values = Get-Content -LiteralPath $valuesPath -Raw
if ($values -match '(?i)<(?:WEB|API|IMAGE|DIGEST|REVISION|HOSTNAME|NAMESPACE)[^>]*>|\b(?:CHANGEME|REPLACE_ME)\b') {
  Fail 'DEPLOYMENT_PACKAGE_PLACEHOLDER'
}
$secretPattern = '(?im)^\s*(?:adminPassword|mysqlPassword|mysqlRootPassword|password|token|cookie|privateKey|accessKeyId|secretAccessKey)\s*:\s*["'']?(?<value>[^\s"'']+)'
if ([regex]::IsMatch($values, $secretPattern)) { Fail 'DEPLOYMENT_PACKAGE_SECRET_VALUE' }

$digestMatches = [regex]::Matches($values, '(?m)^\s{4}digest:\s*["'']?(?<digest>sha256:[a-f0-9]{64})["'']?\s*$')
if ($digestMatches.Count -ne 2) { Fail 'DEPLOYMENT_PACKAGE_PLACEHOLDER' }
$valueDigests = @($digestMatches | ForEach-Object { $_.Groups['digest'].Value })
if ($valueDigests[0] -ne $manifest.images.web.digest -or $valueDigests[1] -ne $manifest.images.api.digest) {
  Fail 'DEPLOYMENT_PACKAGE_DIGEST_MISMATCH'
}

$apiReplica = [regex]::Match($values, '(?ms)^api:\s*.*?^\s{2}replicaCount:\s*(?<count>\d+)\s*$').Groups['count'].Value
$filesystemMedia = $values -match '(?m)^\s{2}backend:\s*filesystem\s*$'
$hasRwo = $values -match '(?m)^\s*-\s*ReadWriteOnce\s*$'
$hasRwx = $values -match '(?m)^\s*-\s*ReadWriteMany\s*$'
if ($filesystemMedia -and [int]$apiReplica -gt 1 -and $hasRwo -and !$hasRwx) { Fail 'DEPLOYMENT_PACKAGE_MEDIA_TOPOLOGY' }

$helm = Resolve-Helm
$chart = Resolve-WorkspacePath 'deploy/helm/lifeops-web'
$lintOutput = & $helm lint $chart --strict --values $valuesPath 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { Fail 'DEPLOYMENT_PACKAGE_HELM_LINT' }
$mediaValidator = Require-File 'scripts/validate-media-topology.ps1'
Invoke-CheckedPowerShell $mediaValidator @('-ValuesFile', $valuesPath, '-HelmExecutable', $helm) 'DEPLOYMENT_PACKAGE_MEDIA_TOPOLOGY'
$renderValidator = Require-File 'scripts/validate-rendered-helm.ps1'
Invoke-CheckedPowerShell $renderValidator @('-ValuesFile', $valuesPath, '-Production', '-HelmExecutable', $helm) 'DEPLOYMENT_PACKAGE_HELM_RENDER'

$checklistText = Get-Content -LiteralPath $checklist -Raw
$rollbackText = Get-Content -LiteralPath $rollback -Raw
$manual = "$checklistText`n$rollbackText"
$requiredManualTokens = @(
  'lifeops-web', 'lifeops-api', 'Gateway API', 'Secret', 'ExternalSecret',
  'MySQL', 'mysql:8.4.10', 'ReadWriteMany', 'S3', 'Envoy Gateway',
  'NGINX Gateway Fabric', 'Ingress', 'API maximum database connections', 'HPA',
  'post-deploy-smoke.ps1', 'migration Job', 'Argo CD', 'Helm', 'Redis',
  'templates/httproute.yaml'
)
foreach ($token in $requiredManualTokens) {
  if ($manual -notmatch [regex]::Escape($token)) { Fail 'DEPLOYMENT_PACKAGE_MANUAL_SECTION' }
}
foreach ($label in @('Run from:', 'Expected:', 'Failure means:', 'Safe fallback:')) {
  if ($manual -notmatch [regex]::Escape($label)) { Fail 'DEPLOYMENT_PACKAGE_COMMAND_SAFETY' }
}
if ($manual -match '--docker-password(?:-file)?(?:=|\s)' -or $manual -notmatch '--from-file=\.dockerconfigjson=<PRIVATE_DOCKER_CONFIG_JSON>') {
  Fail 'DEPLOYMENT_PACKAGE_COMMAND_SAFETY'
}
$requiredAssets = @(
  'templates/deployment.yaml', 'templates/api-deployment.yaml', 'templates/service.yaml',
  'templates/api-service.yaml', 'templates/httproute.yaml', 'templates/ingress.yaml',
  'templates/mysql-statefulset.yaml', 'templates/migration-job.yaml', 'templates/media-pvc.yaml',
  'templates/networkpolicy.yaml', 'templates/pdb.yaml', 'templates/hpa.yaml',
  'templates/external-secret.yaml', 'values.schema.json'
)
foreach ($asset in $requiredAssets) {
  if ($manual -notmatch [regex]::Escape($asset)) { Fail 'DEPLOYMENT_PACKAGE_ASSET_MAPPING' }
}

$argo = Get-Content -LiteralPath (Require-File 'deploy/argocd/application.example.yaml') -Raw
if ($argo -notmatch 'kind:\s*Application' -or $argo -notmatch 'deploy/helm/lifeops-web' -or $argo -notmatch 'deploy/gitops/environments/production/values.yaml') {
  Fail 'DEPLOYMENT_PACKAGE_ASSET_MAPPING'
}

$summaryResolved = Resolve-WorkspacePath $SummaryPath
$summaryDirectory = Split-Path -Parent $summaryResolved
if (!(Test-Path -LiteralPath $summaryDirectory -PathType Container)) { New-Item -ItemType Directory -Path $summaryDirectory -Force | Out-Null }
@(
  '# LifeOps deployment package validation',
  '',
  'deployment-package-validation: ok',
  "source-revision: $($manifest.sourceRevision)",
  "web-digest: $($manifest.images.web.digest)",
  "api-digest: $($manifest.images.api.digest)",
  'helm-lint: ok',
  'helm-render-production: ok',
  'media-topology: ok',
  'manual-contract: ok',
  'cluster-operations: not-run (user-owned)'
) | Set-Content -LiteralPath $summaryResolved -Encoding UTF8

Write-Output 'deployment-package-validation: ok'
