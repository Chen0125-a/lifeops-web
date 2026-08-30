[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$BaseUrl,
  [Parameter(Mandatory = $true)][string]$ExpectedWebDigest,
  [Parameter(Mandatory = $true)][string]$ExpectedApiDigest,
  [Parameter(Mandatory = $true)][string]$ExpectedRevision,
  [string]$ObservedWebDigest = '',
  [string]$ObservedApiDigest = '',
  [string]$ObservedRevision = '',
  [PSCredential]$Credential,
  [string]$ScenarioFile = '',
  [string]$ReportPath = 'outputs/final/user-deployment-smoke-report.json'
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$digestPattern = '^sha256:[a-f0-9]{64}$'
$revisionPattern = '^[a-f0-9]{40}$'
function Fail([string]$Code) { throw $Code }
function Resolve-OutputPath([string]$PathValue) {
  $candidate = if ([IO.Path]::IsPathRooted($PathValue)) { $PathValue } else { Join-Path $workspace $PathValue }
  return [IO.Path]::GetFullPath($candidate)
}

if ($BaseUrl -notmatch '^https://[^\s/]+(?:/[^\s]*)?$') { Fail 'SMOKE_BASE_URL_HTTPS_REQUIRED' }
if ($ExpectedRevision -notmatch $revisionPattern) { Fail 'SMOKE_EXPECTED_REVISION_INVALID' }
if ($ExpectedWebDigest -notmatch $digestPattern -or $ExpectedApiDigest -notmatch $digestPattern) { Fail 'SMOKE_EXPECTED_DIGEST_INVALID' }
$normalizedBaseUrl = $BaseUrl.TrimEnd('/')
$prefix = 'lifeops-smoke-' + [DateTimeOffset]::UtcNow.ToString('yyyyMMddHHmmss') + '-'

function Assert-ObservedIdentity([string]$ActualRevision, [string]$ActualWebDigest, [string]$ActualApiDigest) {
  if ($ActualRevision -notmatch $revisionPattern -or $ActualRevision -ne $ExpectedRevision) { Fail 'SMOKE_EXPECTED_REVISION_INVALID' }
  if ($ActualWebDigest -notmatch $digestPattern -or $ActualApiDigest -notmatch $digestPattern) { Fail 'SMOKE_EXPECTED_DIGEST_INVALID' }
  if ($ActualWebDigest -ne $ExpectedWebDigest -or $ActualApiDigest -ne $ExpectedApiDigest) { Fail 'SMOKE_EXPECTED_DIGEST_INVALID' }
}

if ($ScenarioFile) {
  if ($env:LIFEOPS_SMOKE_TEST_MODE -ne '1') { Fail 'SMOKE_SCENARIO_FORBIDDEN' }
  $scenarioPath = Resolve-OutputPath $ScenarioFile
  if (!(Test-Path -LiteralPath $scenarioPath -PathType Leaf)) { Fail 'SMOKE_SCENARIO_INVALID' }
  $scenario = try { Get-Content -LiteralPath $scenarioPath -Raw | ConvertFrom-Json } catch { Fail 'SMOKE_SCENARIO_INVALID' }
  Assert-ObservedIdentity $scenario.actualRevision $scenario.actualWebDigest $scenario.actualApiDigest
  if ($scenario.health.web -ne 'ok' -or $scenario.health.api -ne 'ok' -or $scenario.health.ready -ne 'ok') { Fail 'SMOKE_HEALTH_FAILED' }
  if (!$scenario.auth.passed) { Fail 'SMOKE_AUTH_FAILED' }
  if (!$scenario.persistence.passed -or $scenario.persistence.createdId -ne $scenario.persistence.reloadedId -or $scenario.persistence.createdId -notlike 'lifeops-smoke-*') {
    Fail 'SMOKE_PERSISTENCE_FAILED'
  }
  if (!$scenario.lifeSentinel.passed -or $scenario.lifeSentinel.effectCount -ne 1 -or $scenario.lifeSentinel.firstEffectId -ne $scenario.lifeSentinel.retryEffectId) {
    Fail 'SMOKE_LIFE_SENTINEL_FAILED'
  }
  foreach ($target in @($scenario.cleanupTargets)) {
    if ($target.kind -notin @('record', 'inventory-transaction') -or $target.id -notlike 'lifeops-smoke-*') { Fail 'SMOKE_CLEANUP_SCOPE_VIOLATION' }
  }
} else {
  Assert-ObservedIdentity $ObservedRevision $ObservedWebDigest $ObservedApiDigest
  try {
    $webHealth = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$normalizedBaseUrl/healthz" -TimeoutSec 15
    if ($webHealth.StatusCode -ne 200) { Fail 'SMOKE_HEALTH_FAILED' }
  } catch { Fail 'SMOKE_HEALTH_FAILED' }

  try {
    $null = Invoke-WebRequest -UseBasicParsing -Method Get -Uri "$normalizedBaseUrl/api/v1/auth/session" -TimeoutSec 15
  } catch {
    $status = try { [int]$_.Exception.Response.StatusCode } catch { 0 }
    if ($status -ne 401) { Fail 'SMOKE_HEALTH_FAILED' }
  }

  if (!$Credential) { $Credential = Get-Credential -Message 'Enter the LifeOps smoke account. The credential remains in this process only.' }
  if (!$Credential) { Fail 'SMOKE_AUTH_FAILED' }
  $prior = @{
    BaseUrl = $env:LIFEOPS_DEPLOYMENT_BASE_URL
    Account = $env:LIFEOPS_SMOKE_ACCOUNT
    Password = $env:LIFEOPS_SMOKE_PASSWORD
    Prefix = $env:LIFEOPS_SMOKE_PREFIX
  }
  try {
    $env:LIFEOPS_DEPLOYMENT_BASE_URL = $normalizedBaseUrl
    $env:LIFEOPS_SMOKE_ACCOUNT = $Credential.UserName
    $env:LIFEOPS_SMOKE_PASSWORD = $Credential.GetNetworkCredential().Password
    $env:LIFEOPS_SMOKE_PREFIX = $prefix
    $output = & npx.cmd playwright test --config playwright.deployment.config.ts tests/deployment-smoke.spec.ts tests/deployment-persistence.spec.ts 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) {
      if ($output -match 'SMOKE_AUTH_FAILED') { Fail 'SMOKE_AUTH_FAILED' }
      if ($output -match 'SMOKE_PERSISTENCE_FAILED') { Fail 'SMOKE_PERSISTENCE_FAILED' }
      if ($output -match 'SMOKE_LIFE_SENTINEL_FAILED') { Fail 'SMOKE_LIFE_SENTINEL_FAILED' }
      if ($output -match 'SMOKE_CLEANUP_SCOPE_VIOLATION') { Fail 'SMOKE_CLEANUP_SCOPE_VIOLATION' }
      Fail 'SMOKE_BROWSER_FAILED'
    }
  } finally {
    if ($null -eq $prior.BaseUrl) { Remove-Item Env:LIFEOPS_DEPLOYMENT_BASE_URL -ErrorAction SilentlyContinue } else { $env:LIFEOPS_DEPLOYMENT_BASE_URL = $prior.BaseUrl }
    if ($null -eq $prior.Account) { Remove-Item Env:LIFEOPS_SMOKE_ACCOUNT -ErrorAction SilentlyContinue } else { $env:LIFEOPS_SMOKE_ACCOUNT = $prior.Account }
    if ($null -eq $prior.Password) { Remove-Item Env:LIFEOPS_SMOKE_PASSWORD -ErrorAction SilentlyContinue } else { $env:LIFEOPS_SMOKE_PASSWORD = $prior.Password }
    if ($null -eq $prior.Prefix) { Remove-Item Env:LIFEOPS_SMOKE_PREFIX -ErrorAction SilentlyContinue } else { $env:LIFEOPS_SMOKE_PREFIX = $prior.Prefix }
  }
}

$report = Resolve-OutputPath $ReportPath
$reportDirectory = Split-Path -Parent $report
if (!(Test-Path -LiteralPath $reportDirectory -PathType Container)) { New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null }
@{
  schemaVersion = 1
  marker = 'post-deploy-smoke: ok'
  baseUrlOrigin = ([Uri]$normalizedBaseUrl).GetLeftPart([UriPartial]::Authority)
  expectedRevision = $ExpectedRevision
  expectedWebDigest = $ExpectedWebDigest
  expectedApiDigest = $ExpectedApiDigest
  checks = @('web-health', 'api-reachability', 'auth', 'persistence', 'life-exactly-once', 'bounded-cleanup')
  clusterMutation = $false
  completedAt = [DateTimeOffset]::UtcNow.ToString('o')
} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $report -Encoding UTF8

Write-Output 'post-deploy-smoke: ok'
