param([string]$WorkspaceRoot = '')

$ErrorActionPreference = 'Stop'
if (!$WorkspaceRoot) { $WorkspaceRoot = Split-Path -Parent $PSScriptRoot }
$WorkspaceRoot = [IO.Path]::GetFullPath($WorkspaceRoot)
$ci = [IO.File]::ReadAllText((Join-Path $WorkspaceRoot '.github/workflows/ci.yml'))
$release = [IO.File]::ReadAllText((Join-Path $WorkspaceRoot '.github/workflows/release.yml'))
$webDockerfile = [IO.File]::ReadAllText((Join-Path $WorkspaceRoot 'Dockerfile'))
$apiDockerfile = [IO.File]::ReadAllText((Join-Path $WorkspaceRoot 'server/Dockerfile'))
$imageBrowserSmoke = [IO.File]::ReadAllText((Join-Path $WorkspaceRoot 'scripts/smoke-image-browsers.ps1'))
$failures = [Collections.Generic.List[string]]::new()
function Require([bool]$Condition, [string]$Message) { if (!$Condition) { $script:failures.Add($Message) } }

$all = "$ci`n$release"
foreach ($use in [regex]::Matches($all, '(?m)^\s*-\s*uses:\s*([^\s#]+)(?:\s+#\s*(.+))?\s*$')) {
  Require ($use.Groups[1].Value -match '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+@[a-f0-9]{40}$') "Action is not pinned to a full commit: $($use.Groups[1].Value)"
  Require ($use.Groups[2].Value -match '^v?\d+(?:\.\d+){0,2}') "Pinned action lacks a release tag comment: $($use.Groups[1].Value)"
}
Require ($ci -notmatch '(?m)^\s*pull_request_target:\s*$') 'CI must not expose repository secrets through pull_request_target.'
Require ($ci -match '(?m)^permissions:\s*\r?\n\s+contents:\s*read\s*$') 'CI permissions must be contents: read.'
Require ($release -match '(?m)^permissions:\s*\r?\n\s+contents:\s*write\s*$') 'Release permissions must be limited to contents: write.'
Require ($ci -match '(?ms)^concurrency:\s*.*cancel-in-progress:\s*true') 'CI concurrency must cancel superseded runs.'
Require ($release -match '(?ms)^concurrency:\s*.*cancel-in-progress:\s*false') 'Release concurrency must serialize without cancellation.'
foreach ($document in @($ci, $release)) {
  $jobCount = [regex]::Matches($document, '(?m)^  [A-Za-z0-9_-]+:\s*\r?\n\s+runs-on:').Count
  $timeoutCount = [regex]::Matches($document, '(?m)^\s+timeout-minutes:\s*[1-9][0-9]*\s*$').Count
  Require ($jobCount -gt 0 -and $jobCount -eq $timeoutCount) 'Every workflow job must have one finite timeout.'
  foreach ($timeout in [regex]::Matches($document, '(?m)^\s+timeout-minutes:\s*([1-9][0-9]*)\s*$')) {
    Require ([int]$timeout.Groups[1].Value -ge 90) 'Workflow timeout is too short for the complete serial browser matrix.'
  }
  Require ($document -notmatch '(?ms)options:\s*>-.*?--log-bin-trust-function-creators=1') 'MySQL server arguments must not be placed in service options where Docker treats them as docker create flags.'
  $trustIndex = $document.IndexOf('Configure MySQL trigger migration trust', [StringComparison]::Ordinal)
  $mysqlIndex = $document.IndexOf('Real MySQL 8.4 store integration', [StringComparison]::Ordinal)
  Require ($trustIndex -ge 0 -and $mysqlIndex -gt $trustIndex) 'Workflow must configure MySQL trigger migration trust after service startup and before integration migrations.'
  Require ($document -match 'SET GLOBAL log_bin_trust_function_creators\s*=\s*1') 'Workflow must enable only the required MySQL global before migrations.'
}

foreach ($gate in @(
  'npm ci', 'npm ci --prefix server', 'npm test', 'npm run test:server', 'npm run test:mysql',
  'npm run typecheck', 'npm run typecheck:server', 'npm run build', 'npm run build:server',
  'npm run test:e2e', 'npm run test:e2e:remote', 'helm lint', 'helm template',
  'validate-workflows.ps1', 'smoke-images.test.ps1'
)) { Require ($ci -match [regex]::Escape($gate)) "CI gate is missing: $gate" }
Require ($ci -match '(?i)accessib|a11y') 'CI must explicitly name its accessibility acceptance.'

foreach ($dockerfile in @($webDockerfile, $apiDockerfile)) {
  Require ($dockerfile -match '(?m)^# syntax=docker/dockerfile:\d+\.\d+\.\d+\s*$') 'Dockerfile frontend must use an exact version.'
  foreach ($from in [regex]::Matches($dockerfile, '(?m)^FROM\s+([^\s]+)')) {
    if ($from.Groups[1].Value.Contains(':')) {
      Require ($from.Groups[1].Value -match ':[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.]+)?$') "Base image must use an exact tag: $($from.Groups[1].Value)"
    }
  }
  Require ($dockerfile -match 'org\.opencontainers\.image\.revision="\$OCI_REVISION"') 'OCI revision label is missing.'
  Require ($dockerfile -match 'org\.opencontainers\.image\.source="\$OCI_SOURCE"') 'OCI source label is missing.'
  Require ($dockerfile -notmatch '(?m)^RUN\s+.*(?:apk|apt-get|yum)\s+.*(?:curl|wget|bash|sh)') 'Runtime image must not install a shell/probe package solely for health checks.'
}

foreach ($required in @('--platform linux/amd64', '--provenance=mode=max', '--sbom=true', '--password-stdin', 'imagetools inspect', 'smoke-images.ps1', 'smoke-image-browsers.ps1', '-RequireDigest', 'update-gitops-values.mjs')) {
  Require ($release -match [regex]::Escape($required)) "Release contract is missing: $required"
}
$smokeIndex = $release.IndexOf('smoke-images.ps1', [StringComparison]::Ordinal)
$browserSmokeIndex = $release.IndexOf('smoke-image-browsers.ps1', [StringComparison]::Ordinal)
$updateIndex = $release.IndexOf('update-gitops-values.mjs', [StringComparison]::Ordinal)
Require ($smokeIndex -ge 0 -and $updateIndex -gt $smokeIndex) 'Exact-digest smoke must precede the GitOps update.'
Require ($browserSmokeIndex -gt $smokeIndex -and $updateIndex -gt $browserSmokeIndex) 'Exact-digest browser acceptance must run after image smoke and before the GitOps update.'
Require ($release -match '-SourceRevision\s+"\$env:GITHUB_SHA"') 'Exact-digest browser acceptance must bind the release source revision.'
Require ($imageBrowserSmoke -match "mcr\.microsoft\.com/playwright:v1\.62\.1-noble") 'Exact-digest browser acceptance must use the pinned official Linux Playwright image.'
Require ($imageBrowserSmoke -match 'playwright\.image\.config\.ts' -and $imageBrowserSmoke -match 'playwright\.remote\.image\.config\.ts') 'Exact-digest browser acceptance must run both UI and real-API browser configurations.'

$inRunBlock = $false
$runIndent = 0
foreach ($line in ($release -split '\r?\n')) {
  if ($line -match '^(\s*)run:\s*(.*)$') {
    $runIndent = $Matches[1].Length
    $inRunBlock = $Matches[2].Trim() -in @('|', '|-', '>', '>-')
    if ($Matches[2] -match '\$\{\{\s*secrets\.') { $failures.Add('A secret is interpolated directly into command arguments.'); break }
    continue
  }
  if ($inRunBlock) {
    $indent = ([regex]::Match($line, '^\s*').Value).Length
    if ($line.Trim() -and $indent -le $runIndent) { $inRunBlock = $false }
    elseif ($line -match '\$\{\{\s*secrets\.') { $failures.Add('A secret is interpolated directly into a run block.'); break }
  }
}
Require ($release -match '(?ms)env:\s*\r?\n\s+UHUB_USERNAME:\s*\$\{\{\s*secrets\.UHUB_USERNAME\s*\}\}\s*\r?\n\s+UHUB_PASSWORD:\s*\$\{\{\s*secrets\.UHUB_PASSWORD\s*\}\}') 'UHub credentials must be bound through step env values.'

foreach ($relative in @('scripts/resolve-action-shas.ps1', 'scripts/smoke-images.ps1', 'scripts/update-gitops-values.mjs')) {
  Require (Test-Path -LiteralPath (Join-Path $WorkspaceRoot $relative) -PathType Leaf) "Required release helper is missing: $relative"
}
if ($failures.Count -gt 0) { throw ("workflow-validation failed:`n- " + ($failures -join "`n- ")) }
Write-Output 'workflow-validation: ok'
