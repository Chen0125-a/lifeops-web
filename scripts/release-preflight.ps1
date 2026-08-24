param(
  [string]$RepositoryRoot = '',
  [string]$WebRepository = '',
  [string]$ApiRepository = '',
  [string]$ValuesFile = '',
  [string]$SummaryPath = ''
)

$ErrorActionPreference = 'Stop'
$results = [Collections.Generic.List[object]]::new()
function Add-Result([string]$Name, [ValidateSet('pass', 'fail', 'warning', 'not-applicable')][string]$Status, [string]$Detail) {
  $script:results.Add([pscustomobject]@{ Name = $Name; Status = $Status; Detail = $Detail })
}
function Invoke-External([string]$Command, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $Command @Arguments 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    return @{ ExitCode = $exitCode; Output = $(if ($null -eq $output) { '' } else { $output.Trim() }) }
  } catch {
    return @{ ExitCode = 1; Output = '' }
  } finally {
    $ErrorActionPreference = $previous
  }
}
function Has-Command([string]$Name) { return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue) }
function Contains-Placeholder([string]$Text) {
  return $Text -match '(?i)REPLACE_ME|CHANGE_ME|<[^>]+>|example\.com|\$\{'
}
function Test-UHubRepositoryRead([string]$Repository) {
  $probe = Invoke-External 'docker' @('manifest', 'inspect', "${Repository}:__lifeops_preflight_missing__")
  if ($probe.ExitCode -eq 0) { return $true }
  return $probe.Output -match '(?i)\bno such manifest\b|\bmanifest unknown\b'
}
function Get-UHubCredential([string]$RegistryHost) {
  if (![string]::IsNullOrWhiteSpace($env:UHUB_USERNAME) -and ![string]::IsNullOrWhiteSpace($env:UHUB_PASSWORD)) {
    return [pscustomobject]@{ Username = $env:UHUB_USERNAME; Password = $env:UHUB_PASSWORD; Source = 'environment' }
  }

  $dockerConfigRoot = if (![string]::IsNullOrWhiteSpace($env:DOCKER_CONFIG)) { $env:DOCKER_CONFIG } else { Join-Path $env:USERPROFILE '.docker' }
  $dockerConfigPath = Join-Path $dockerConfigRoot 'config.json'
  if (!(Test-Path -LiteralPath $dockerConfigPath -PathType Leaf)) { return $null }
  try {
    $dockerConfig = Get-Content -LiteralPath $dockerConfigPath -Raw | ConvertFrom-Json
    $authHosts = @($dockerConfig.auths.PSObject.Properties.Name)
    if ($authHosts -notcontains $RegistryHost) { return $null }
    $helperSuffix = ''
    if ($dockerConfig.credHelpers -and $dockerConfig.credHelpers.PSObject.Properties.Name -contains $RegistryHost) {
      $helperSuffix = [string]$dockerConfig.credHelpers.$RegistryHost
    } elseif ($dockerConfig.credsStore) {
      $helperSuffix = [string]$dockerConfig.credsStore
    }
    if ([string]::IsNullOrWhiteSpace($helperSuffix)) { return $null }
    $helper = Get-Command "docker-credential-$helperSuffix" -ErrorAction SilentlyContinue
    if (!$helper) { return $null }
    $credentialJson = $RegistryHost | & $helper.Source get 2>$null | Out-String
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($credentialJson)) { return $null }
    $credential = $credentialJson | ConvertFrom-Json
    $storedServer = ([string]$credential.ServerURL).TrimEnd('/') -replace '^https?://', ''
    if ($storedServer -ne $RegistryHost -or [string]::IsNullOrWhiteSpace($credential.Username) -or [string]::IsNullOrWhiteSpace($credential.Secret)) { return $null }
    return [pscustomobject]@{ Username = [string]$credential.Username; Password = [string]$credential.Secret; Source = 'docker-credential-store' }
  } catch {
    return $null
  }
}

if (!$RepositoryRoot) { $RepositoryRoot = Split-Path -Parent $PSScriptRoot }
$RepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot)
if (!$ValuesFile) { $ValuesFile = Join-Path $RepositoryRoot 'deploy/gitops/environments/production/values.yaml' }
elseif (![IO.Path]::IsPathRooted($ValuesFile)) { $ValuesFile = Join-Path $RepositoryRoot $ValuesFile }
$ValuesFile = [IO.Path]::GetFullPath($ValuesFile)
if (!$SummaryPath) { $SummaryPath = Join-Path $RepositoryRoot 'outputs/final/release-preflight-summary.md' }
elseif (![IO.Path]::IsPathRooted($SummaryPath)) { $SummaryPath = Join-Path $RepositoryRoot $SummaryPath }
$SummaryPath = [IO.Path]::GetFullPath($SummaryPath)

$gitAvailable = Has-Command 'git'
Add-Result 'git-cli' ($(if ($gitAvailable) { 'pass' } else { 'fail' })) ($(if ($gitAvailable) { 'git is available' } else { 'git is unavailable' }))
$isGitRoot = $false
$sourceRevision = ''
if ($gitAvailable -and (Test-Path -LiteralPath $RepositoryRoot -PathType Container)) {
  $rootResult = Invoke-External 'git' @('-C', $RepositoryRoot, 'rev-parse', '--show-toplevel')
  $isGitRoot = $rootResult.ExitCode -eq 0 -and [IO.Path]::GetFullPath($rootResult.Output) -eq $RepositoryRoot
}
Add-Result 'git-root' ($(if ($isGitRoot) { 'pass' } else { 'fail' })) ($(if ($isGitRoot) { 'repository root is verified' } else { 'repository root is missing or does not match the requested path' }))

if ($isGitRoot) {
  $revisionResult = Invoke-External 'git' @('-C', $RepositoryRoot, 'rev-parse', 'HEAD')
  $sourceRevision = $revisionResult.Output
  Add-Result 'git-revision' ($(if ($revisionResult.ExitCode -eq 0 -and $sourceRevision -match '^[a-f0-9]{40,64}$') { 'pass' } else { 'fail' })) 'HEAD must resolve to an immutable revision'

  $branchResult = Invoke-External 'git' @('-C', $RepositoryRoot, 'symbolic-ref', '--short', 'HEAD')
  Add-Result 'git-branch' ($(if ($branchResult.ExitCode -eq 0 -and $branchResult.Output) { 'pass' } else { 'fail' })) 'a named release branch is required'

  $originResult = Invoke-External 'git' @('-C', $RepositoryRoot, 'remote', 'get-url', 'origin')
  $originSafe = $originResult.ExitCode -eq 0 -and $originResult.Output -and $originResult.Output -notmatch '(?i)://[^/@:]+:[^/@]+@'
  Add-Result 'git-origin' ($(if ($originSafe) { 'pass' } else { 'fail' })) 'origin must exist and must not embed credentials'

  $defaultResult = Invoke-External 'git' @('-C', $RepositoryRoot, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  Add-Result 'git-default-branch' ($(if ($defaultResult.ExitCode -eq 0) { 'pass' } else { 'warning' })) ($(if ($defaultResult.ExitCode -eq 0) { 'origin default branch is known' } else { 'origin default branch is not locally resolved' }))

  $dirtyResult = Invoke-External 'git' @('-C', $RepositoryRoot, 'status', '--porcelain=v1', '--untracked-files=all')
  Add-Result 'git-clean' ($(if ($dirtyResult.ExitCode -eq 0 -and !$dirtyResult.Output) { 'pass' } else { 'fail' })) 'release requires a clean working tree; unrelated or untracked changes are not auto-discarded'
} else {
  foreach ($name in @('git-revision', 'git-branch', 'git-origin', 'git-default-branch', 'git-clean')) {
    Add-Result $name 'not-applicable' 'not evaluated because git-root failed'
  }
}

$ghAvailable = Has-Command 'gh'
Add-Result 'github-cli' ($(if ($ghAvailable) { 'pass' } else { 'fail' })) ($(if ($ghAvailable) { 'GitHub CLI is available' } else { 'GitHub CLI is unavailable' }))
if ($ghAvailable -and $isGitRoot) {
  $authResult = Invoke-External 'gh' @('auth', 'status')
  Add-Result 'github-auth' ($(if ($authResult.ExitCode -eq 0) { 'pass' } else { 'fail' })) 'GitHub authentication must be valid'
  $workflowResult = Invoke-External 'gh' @('workflow', 'view', '.github/workflows/release.yml', '--repo', $originResult.Output)
  Add-Result 'github-dispatch-capability' ($(if ($workflowResult.ExitCode -eq 0) { 'pass' } else { 'fail' })) 'the pinned release workflow must be readable before dispatch'
} else {
  Add-Result 'github-auth' 'not-applicable' 'not evaluated without GitHub CLI and a verified repository'
  Add-Result 'github-dispatch-capability' 'not-applicable' 'not evaluated without GitHub CLI and a verified repository'
}

$dockerAvailable = Has-Command 'docker'
Add-Result 'docker-cli' ($(if ($dockerAvailable) { 'pass' } else { 'fail' })) ($(if ($dockerAvailable) { 'Docker CLI is available' } else { 'Docker CLI is unavailable' }))
if ($dockerAvailable) {
  $dockerResult = Invoke-External 'docker' @('info', '--format', '{{.ServerVersion}}')
  Add-Result 'docker-engine' ($(if ($dockerResult.ExitCode -eq 0 -and $dockerResult.Output) { 'pass' } else { 'fail' })) 'Docker Engine must be reachable'
  $buildxResult = Invoke-External 'docker' @('buildx', 'version')
  Add-Result 'docker-buildx' ($(if ($buildxResult.ExitCode -eq 0) { 'pass' } else { 'fail' })) 'Docker Buildx must be available'
} else {
  Add-Result 'docker-engine' 'not-applicable' 'not evaluated because Docker CLI is unavailable'
  Add-Result 'docker-buildx' 'not-applicable' 'not evaluated because Docker CLI is unavailable'
}

$helmAvailable = Has-Command 'helm'
if ($helmAvailable) {
  $helmResult = Invoke-External 'helm' @('version', '--short')
  Add-Result 'helm-cli' ($(if ($helmResult.ExitCode -eq 0) { 'pass' } else { 'fail' })) 'Helm CLI must be available for render validation only'
} else {
  Add-Result 'helm-cli' 'fail' 'Helm CLI is unavailable'
}

$repositoryPattern = '^uhub\.service\.ucloud\.cn/[a-z0-9._-]+/[a-z0-9._-]+$'
$repositoriesValid = $WebRepository -match $repositoryPattern -and $ApiRepository -match $repositoryPattern -and $WebRepository -ne $ApiRepository
Add-Result 'uhub-repository-names' ($(if ($repositoriesValid) { 'pass' } else { 'fail' })) 'Web and API must name distinct UHub repositories'
$uhubCredential = Get-UHubCredential 'uhub.service.ucloud.cn'
$credentialsPresent = $null -ne $uhubCredential
Add-Result 'uhub-credentials' ($(if ($credentialsPresent) { 'pass' } else { 'fail' })) 'UHub credentials must be available through approved environment variables or the Docker credential store; values are never printed'
if ($credentialsPresent -and $repositoriesValid -and $dockerAvailable) {
  $webReadable = Test-UHubRepositoryRead $WebRepository
  $apiReadable = Test-UHubRepositoryRead $ApiRepository
  Add-Result 'uhub-repository-read' ($(if ($webReadable -and $apiReadable) { 'pass' } else { 'fail' })) 'both UHub repositories must pass Docker-native manifest probes; exact no-such-manifest is accepted before first release while unauthorized or denied results fail'
} else {
  Add-Result 'uhub-repository-read' 'not-applicable' 'not evaluated until Docker, credentials and repository names are available'
}
$uhubCredential = $null

if (Test-Path -LiteralPath $ValuesFile -PathType Leaf) {
  $values = Get-Content -LiteralPath $ValuesFile -Raw
  Add-Result 'production-values-file' 'pass' 'production values file exists'
  $webRepositoryMatches = $values -match "(?m)^\s*repository:\s*$([regex]::Escape($WebRepository))\s*$"
  $apiRepositoryMatches = $values -match "(?m)^\s*repository:\s*$([regex]::Escape($ApiRepository))\s*$"
  Add-Result 'production-repositories' ($(if ($webRepositoryMatches -and $apiRepositoryMatches) { 'pass' } else { 'fail' })) 'production values must contain both confirmed repositories'
  $digestMatches = [regex]::Matches($values, '(?m)^\s*digest:\s*["'']?([^"''\s#]*)["'']?\s*(?:#.*)?$')
  $digestValues = @($digestMatches | ForEach-Object { $_.Groups[1].Value })
  if ($digestValues.Count -eq 2 -and @($digestValues | Where-Object { $_ -ne '' }).Count -eq 0) {
    Add-Result 'production-digests' 'not-applicable' 'immutable digests are intentionally empty before the verified release workflow populates them'
  } elseif ($digestValues.Count -eq 2 -and @($digestValues | Where-Object { $_ -notmatch '^sha256:[a-f0-9]{64}$' }).Count -eq 0) {
    Add-Result 'production-digests' 'pass' 'production values contain exactly two immutable sha256 digests'
  } else {
    Add-Result 'production-digests' 'fail' 'digests must be either two empty pre-release fields or two immutable sha256 values; mixed or mutable values are forbidden'
  }
  Add-Result 'production-placeholders' ($(if (Contains-Placeholder $values) { 'fail' } else { 'pass' })) 'deployable production values must not retain placeholder hostnames or tokens'
} else {
  Add-Result 'production-values-file' 'fail' 'production values file is missing'
  foreach ($name in @('production-repositories', 'production-digests', 'production-placeholders')) {
    Add-Result $name 'not-applicable' 'not evaluated because the production values file is missing'
  }
}

$summaryParent = Split-Path -Parent $SummaryPath
if ($summaryParent) { New-Item -ItemType Directory -Path $summaryParent -Force | Out-Null }
$lines = [Collections.Generic.List[string]]::new()
$lines.Add('# LifeOps release preflight summary')
$lines.Add('')
$lines.Add("- Repository root: ``$RepositoryRoot``")
$lines.Add("- Values file: ``$ValuesFile``")
$lines.Add("- Source revision: ``$(if ($sourceRevision) { $sourceRevision } else { 'unavailable' })``")
$lines.Add('- Credentials recorded: `false`')
$lines.Add('')
$lines.Add('| Check | Result | Detail |')
$lines.Add('|---|---|---|')
foreach ($row in $results) {
  $detail = $row.Detail.Replace('|', '\|').Replace("`r", ' ').Replace("`n", ' ')
  $lines.Add("| $($row.Name) | $($row.Status) | $detail |")
}
$lines.Add('')
$lines.Add('This preflight invokes no cluster client or deployment operation.')
[IO.File]::WriteAllLines($SummaryPath, $lines, [Text.UTF8Encoding]::new($false))

$failed = @($results | Where-Object Status -eq 'fail')
Write-Output "release-preflight: pass=$(@($results | Where-Object Status -eq 'pass').Count) fail=$($failed.Count) warning=$(@($results | Where-Object Status -eq 'warning').Count) not-applicable=$(@($results | Where-Object Status -eq 'not-applicable').Count)"
Write-Output "summary: $SummaryPath"
if ($failed.Count -gt 0) {
  Write-Error ('RELEASE_PREFLIGHT_FAILED: ' + (($failed | ForEach-Object Name) -join ','))
  exit 1
}
Write-Output 'RELEASE_PREFLIGHT_OK'
