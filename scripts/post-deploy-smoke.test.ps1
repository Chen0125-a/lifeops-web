param()

$ErrorActionPreference = 'Stop'
$smoke = Join-Path $PSScriptRoot 'post-deploy-smoke.ps1'
$failures = [Collections.Generic.List[string]]::new()
function Require([bool]$Condition, [string]$Message) { if (!$Condition) { $script:failures.Add($Message) } }

Require (Test-Path -LiteralPath $smoke -PathType Leaf) 'User-run post-deploy smoke must exist.'
if (!(Test-Path -LiteralPath $smoke -PathType Leaf)) {
  throw ("post-deploy-smoke-contract failed:`n- " + ($failures -join "`n- "))
}

$source = Get-Content -LiteralPath $smoke -Raw
foreach ($token in @(
  'SMOKE_BASE_URL_HTTPS_REQUIRED', 'SMOKE_EXPECTED_REVISION_INVALID', 'SMOKE_EXPECTED_DIGEST_INVALID',
  'SMOKE_HEALTH_FAILED', 'SMOKE_AUTH_FAILED', 'SMOKE_PERSISTENCE_FAILED',
  'SMOKE_LIFE_SENTINEL_FAILED', 'SMOKE_CLEANUP_SCOPE_VIOLATION',
  'PSCredential', 'LIFEOPS_SMOKE_TEST_MODE', 'tests/deployment-smoke.spec.ts',
  'tests/deployment-persistence.spec.ts'
)) {
  Require ($source -match [regex]::Escape($token)) "Smoke tool is missing stable contract token: $token"
}
Require ($source -notmatch '(?i)kubectl|helm\s+(?:install|upgrade)|argocd\s+app\s+sync|delete\s+(?:pod|pvc|namespace)') 'Application smoke must not mutate Kubernetes resources.'

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot ('lifeops-post-deploy-smoke-test-' + [guid]::NewGuid().ToString('N')))
$digest = 'sha256:' + ('a' * 64)
$revision = 'b' * 40
$prefix = 'lifeops-smoke-contract-'

function Invoke-Smoke([hashtable]$Scenario, [string]$Name, [string]$BaseUrl = 'https://lifeops.example.test', [string]$WebDigest = $digest, [string]$ExpectedRevision = $revision) {
  $scenarioPath = Join-Path $temp.FullName "$Name.json"
  $reportPath = Join-Path $temp.FullName "$Name-report.json"
  $Scenario | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $scenarioPath -Encoding UTF8
  $prior = $env:LIFEOPS_SMOKE_TEST_MODE
  $env:LIFEOPS_SMOKE_TEST_MODE = '1'
  try {
    $old = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $smoke `
      -BaseUrl $BaseUrl -ExpectedWebDigest $WebDigest -ExpectedApiDigest $digest `
      -ExpectedRevision $ExpectedRevision -ScenarioFile $scenarioPath -ReportPath $reportPath 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $old
    return @{ Output = $output; ExitCode = $exitCode; Report = $reportPath }
  } finally {
    if ($null -eq $prior) { Remove-Item Env:LIFEOPS_SMOKE_TEST_MODE -ErrorAction SilentlyContinue }
    else { $env:LIFEOPS_SMOKE_TEST_MODE = $prior }
  }
}

function Healthy-Scenario {
  return @{
    actualRevision = $revision
    actualWebDigest = $digest
    actualApiDigest = $digest
    health = @{ web = 'ok'; api = 'ok'; ready = 'ok' }
    auth = @{ passed = $true }
    persistence = @{ createdId = "$prefix-record"; reloadedId = "$prefix-record"; passed = $true }
    lifeSentinel = @{ firstEffectId = "$prefix-effect"; retryEffectId = "$prefix-effect"; effectCount = 1; passed = $true }
    cleanupTargets = @(@{ kind = 'record'; id = "$prefix-record" })
  }
}

try {
  $healthy = Invoke-Smoke (Healthy-Scenario) 'healthy'
  Require ($healthy.ExitCode -eq 0) "A complete application-only smoke scenario must pass. Output: $($healthy.Output)"
  Require (Test-Path -LiteralPath $healthy.Report -PathType Leaf) 'Passing smoke must write a sanitized report.'
  if (Test-Path -LiteralPath $healthy.Report -PathType Leaf) {
    $report = Get-Content -LiteralPath $healthy.Report -Raw
    Require ($report -match 'post-deploy-smoke: ok') 'Smoke report must include the stable success marker.'
    Require ($report -notmatch '(?i)(?:password|cookie|token)\s*[:=]\s*\S+') 'Smoke report must not serialize credentials.'
  }

  $http = Invoke-Smoke (Healthy-Scenario) 'http' 'http://lifeops.example.test'
  Require ($http.ExitCode -ne 0 -and $http.Output -match 'SMOKE_BASE_URL_HTTPS_REQUIRED') 'Non-HTTPS base URLs must fail before transport.'

  $badDigest = Invoke-Smoke (Healthy-Scenario) 'bad-digest' 'https://lifeops.example.test' 'latest'
  Require ($badDigest.ExitCode -ne 0 -and $badDigest.Output -match 'SMOKE_EXPECTED_DIGEST_INVALID') 'Mutable or malformed expected digests must fail.'

  $healthScenario = Healthy-Scenario
  $healthScenario.health.api = 'failed'
  $health = Invoke-Smoke $healthScenario 'health-failure'
  Require ($health.ExitCode -ne 0 -and $health.Output -match 'SMOKE_HEALTH_FAILED') 'Failed health must fail the smoke.'

  $authScenario = Healthy-Scenario
  $authScenario.auth.passed = $false
  $auth = Invoke-Smoke $authScenario 'auth-failure'
  Require ($auth.ExitCode -ne 0 -and $auth.Output -match 'SMOKE_AUTH_FAILED') 'Failed authentication must fail the smoke.'

  $persistenceScenario = Healthy-Scenario
  $persistenceScenario.persistence.reloadedId = "$prefix-other"
  $persistence = Invoke-Smoke $persistenceScenario 'persistence-failure'
  Require ($persistence.ExitCode -ne 0 -and $persistence.Output -match 'SMOKE_PERSISTENCE_FAILED') 'Missing restart/reload persistence must fail the smoke.'

  $lifeScenario = Healthy-Scenario
  $lifeScenario.lifeSentinel.retryEffectId = "$prefix-duplicate"
  $lifeScenario.lifeSentinel.effectCount = 2
  $life = Invoke-Smoke $lifeScenario 'life-failure'
  Require ($life.ExitCode -ne 0 -and $life.Output -match 'SMOKE_LIFE_SENTINEL_FAILED') 'Non-idempotent Life sentinel behavior must fail the smoke.'

  $cleanupScenario = Healthy-Scenario
  $cleanupScenario.cleanupTargets = @(@{ kind = 'namespace'; id = 'lifeops' })
  $cleanup = Invoke-Smoke $cleanupScenario 'cleanup-failure'
  Require ($cleanup.ExitCode -ne 0 -and $cleanup.Output -match 'SMOKE_CLEANUP_SCOPE_VIOLATION') 'Cleanup outside smoke-created application records must fail.'
} finally {
  $resolved = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected temp path: $resolved" }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

if ($failures.Count -gt 0) { throw ("post-deploy-smoke-contract failed:`n- " + ($failures -join "`n- ")) }
Write-Output 'post-deploy-smoke-contract: ok'
