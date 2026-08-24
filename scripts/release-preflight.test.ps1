param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$scriptPath = Join-Path $PSScriptRoot 'release-preflight.ps1'
$failures = [Collections.Generic.List[string]]::new()
function Require([bool]$Condition, [string]$Message) { if (!$Condition) { $script:failures.Add($Message) } }
function Invoke-Preflight([string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath @Arguments 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previous
  return @{ Output = $output; ExitCode = $exitCode }
}

Require (Test-Path -LiteralPath $scriptPath -PathType Leaf) 'Release preflight script must be loadable.'
$source = Get-Content -LiteralPath $scriptPath -Raw
foreach ($token in @('RepositoryRoot', 'WebRepository', 'ApiRepository', 'ValuesFile', 'SummaryPath', 'pass', 'fail', 'warning', 'not-applicable')) {
  Require ($source -match [regex]::Escape($token)) "Release preflight contract is missing token: $token"
}
Require ($source -notmatch '(?i)kubectl|kubeconfig|helm\s+(?:install|upgrade)|argo\s+(?:sync|rollback)') 'Release preflight must not inspect or mutate a cluster.'

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot ('lifeops-release-preflight-test-' + [guid]::NewGuid().ToString('N')))
$originalPath = $env:PATH
$originalDockerConfig = $env:DOCKER_CONFIG
try {
  $dockerConfigRoot = New-Item -ItemType Directory -Path (Join-Path $temp.FullName 'docker-config')
  '{"auths":{},"credsStore":"wincred"}' | Set-Content -LiteralPath (Join-Path $dockerConfigRoot.FullName 'config.json') -Encoding ASCII
  $env:DOCKER_CONFIG = $dockerConfigRoot.FullName
  $values = Join-Path $temp.FullName 'values.yaml'
  @'
production: true
web:
  image:
    repository: uhub.service.ucloud.cn/chenucloud/lifeops-web
    digest: ""
api:
  image:
    repository: uhub.service.ucloud.cn/chenucloud/lifeops-api
    digest: ""
'@ | Set-Content -LiteralPath $values -Encoding UTF8
  $summary = Join-Path $temp.FullName 'summary.md'
  $env:UHUB_PASSWORD = 'lifeops-preflight-secret-sentinel'
  $result = Invoke-Preflight @(
    '-RepositoryRoot', $temp.FullName,
    '-WebRepository', 'uhub.service.ucloud.cn/chenucloud/lifeops-web',
    '-ApiRepository', 'uhub.service.ucloud.cn/chenucloud/lifeops-api',
    '-ValuesFile', $values,
    '-SummaryPath', $summary
  )
  Require ($result.ExitCode -ne 0) 'A non-Git directory must fail release preflight.'
  Require (Test-Path -LiteralPath $summary -PathType Leaf) 'Failed preflight must still write a sanitized summary.'
  if (Test-Path -LiteralPath $summary -PathType Leaf) {
    $summaryText = Get-Content -LiteralPath $summary -Raw
    Require ($summaryText -match '(?im)git-root.*fail') 'Summary must name the failed Git-root prerequisite.'
    Require ($summaryText -match '(?im)production-digests.*not-applicable') 'Empty pre-release digests must remain release-pending, not fail Step 3 preflight.'
    Require ($summaryText -notmatch 'lifeops-preflight-secret-sentinel') 'Summary must not contain credential values.'
  }
  Require ($result.Output -notmatch 'lifeops-preflight-secret-sentinel') 'Console output must not contain credential values.'

  $missingValues = Invoke-Preflight @(
    '-RepositoryRoot', $workspace,
    '-WebRepository', 'uhub.service.ucloud.cn/chenucloud/lifeops-web',
    '-ApiRepository', 'uhub.service.ucloud.cn/chenucloud/lifeops-api',
    '-ValuesFile', (Join-Path $temp.FullName 'missing.yaml'),
    '-SummaryPath', (Join-Path $temp.FullName 'missing-summary.md')
  )
  Require ($missingValues.ExitCode -ne 0) 'A missing production-values file must fail preflight.'
  Require ($missingValues.Output -notmatch 'lifeops-preflight-secret-sentinel') 'Failure output must remain credential-safe.'

  $helperPath = Join-Path $temp.FullName 'docker-credential-wincred.cmd'
  @'
@echo off
echo {"ServerURL":"uhub.service.ucloud.cn","Username":"fixture-user","Secret":"lifeops-wincred-secret-sentinel"}
'@ | Set-Content -LiteralPath $helperPath -Encoding ASCII
  '{"auths":{"uhub.service.ucloud.cn":{}},"credsStore":"wincred"}' | Set-Content -LiteralPath (Join-Path $dockerConfigRoot.FullName 'config.json') -Encoding ASCII
  $env:PATH = "$($temp.FullName);$originalPath"
  Remove-Item Env:UHUB_USERNAME -ErrorAction SilentlyContinue
  Remove-Item Env:UHUB_PASSWORD -ErrorAction SilentlyContinue
  $helperSummary = Join-Path $temp.FullName 'helper-summary.md'
  $helperResult = Invoke-Preflight @(
    '-RepositoryRoot', $temp.FullName,
    '-WebRepository', 'invalid-web-repository',
    '-ApiRepository', 'invalid-api-repository',
    '-ValuesFile', $values,
    '-SummaryPath', $helperSummary
  )
  Require ($helperResult.ExitCode -ne 0) 'Invalid repository names must still fail preflight when stored credentials exist.'
  $helperSummaryText = Get-Content -LiteralPath $helperSummary -Raw
  Require ($helperSummaryText -match '(?im)uhub-credentials.*pass') 'A usable Docker credential-store record must satisfy credential presence without environment variables.'
  Require ($helperSummaryText -notmatch 'lifeops-wincred-secret-sentinel') 'Docker credential-store secrets must not enter the summary.'
  Require ($helperResult.Output -notmatch 'lifeops-wincred-secret-sentinel') 'Docker credential-store secrets must not enter console output.'

  $dockerPath = Join-Path $temp.FullName 'docker.cmd'
  @'
@echo off
if "%1"=="info" (
  echo 29.7.2
  exit /b 0
)
if "%1"=="buildx" (
  echo github.com/docker/buildx v0.30.1
  exit /b 0
)
if "%1"=="manifest" (
  echo no such manifest: %3 1>&2
  exit /b 1
)
exit /b 1
'@ | Set-Content -LiteralPath $dockerPath -Encoding ASCII
  $nativeSummary = Join-Path $temp.FullName 'native-summary.md'
  $nativeResult = Invoke-Preflight @(
    '-RepositoryRoot', $temp.FullName,
    '-WebRepository', 'uhub.service.ucloud.cn/chenucloud/lifeops-web',
    '-ApiRepository', 'uhub.service.ucloud.cn/chenucloud/lifeops-api',
    '-ValuesFile', $values,
    '-SummaryPath', $nativeSummary
  )
  Require ($nativeResult.ExitCode -ne 0) 'The non-Git fixture must remain a failing overall preflight.'
  $nativeSummaryText = Get-Content -LiteralPath $nativeSummary -Raw
  Require ($nativeSummaryText -match '(?im)uhub-repository-read.*pass') 'Docker-native exact no-such-manifest must prove authenticated first-release repository access.'
  Require ($nativeSummaryText -match '(?im)uhub-repository-read.*Docker-native') 'Preflight evidence must state that repository access used the Docker-native manifest protocol.'
  Require ($nativeSummaryText -notmatch 'lifeops-wincred-secret-sentinel') 'Docker-native repository probing must not leak stored credentials.'
  Require ($nativeResult.Output -notmatch 'lifeops-wincred-secret-sentinel') 'Docker-native repository probing must keep console output credential-safe.'

  @'
@echo off
if "%1"=="info" (
  echo 29.7.2
  exit /b 0
)
if "%1"=="buildx" (
  echo github.com/docker/buildx v0.30.1
  exit /b 0
)
if "%1"=="manifest" (
  echo unauthorized: authentication required 1>&2
  exit /b 1
)
exit /b 1
'@ | Set-Content -LiteralPath $dockerPath -Encoding ASCII
  $deniedSummary = Join-Path $temp.FullName 'denied-summary.md'
  $deniedResult = Invoke-Preflight @(
    '-RepositoryRoot', $temp.FullName,
    '-WebRepository', 'uhub.service.ucloud.cn/chenucloud/lifeops-web',
    '-ApiRepository', 'uhub.service.ucloud.cn/chenucloud/lifeops-api',
    '-ValuesFile', $values,
    '-SummaryPath', $deniedSummary
  )
  Require ($deniedResult.ExitCode -ne 0) 'Docker-native unauthorized repository access must fail preflight.'
  $deniedSummaryText = Get-Content -LiteralPath $deniedSummary -Raw
  Require ($deniedSummaryText -match '(?im)uhub-repository-read.*fail') 'Docker-native unauthorized or denied results must remain a repository-read failure.'
  Require ($deniedSummaryText -notmatch 'lifeops-wincred-secret-sentinel') 'Denied Docker-native probing must not leak stored credentials.'
  Require ($deniedResult.Output -notmatch 'lifeops-wincred-secret-sentinel') 'Denied Docker-native probing must keep console output credential-safe.'
} finally {
  $env:PATH = $originalPath
  if ($null -eq $originalDockerConfig) { Remove-Item Env:DOCKER_CONFIG -ErrorAction SilentlyContinue } else { $env:DOCKER_CONFIG = $originalDockerConfig }
  Remove-Item Env:UHUB_PASSWORD -ErrorAction SilentlyContinue
  $resolved = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected temp path: $resolved" }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

if ($failures.Count -gt 0) { throw ("release-preflight-contract failed:`n- " + ($failures -join "`n- ")) }
Write-Output 'release-preflight-contract: ok'
