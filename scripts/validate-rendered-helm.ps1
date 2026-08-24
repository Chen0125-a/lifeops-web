param(
  [Parameter(Mandatory = $true)]
  [string]$ValuesFile,
  [switch]$Production,
  [string]$HelmExecutable = ''
)

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$chart = Join-Path $workspace 'deploy/helm/lifeops-web'

function Resolve-HelmExecutable {
  if ($HelmExecutable) { return $HelmExecutable }
  $command = Get-Command helm -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $packages = Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages'
  $candidate = Get-ChildItem -LiteralPath $packages -Recurse -Filter 'helm.exe' -File -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (!$candidate) { throw 'Helm executable is required for rendered manifest validation.' }
  return $candidate
}

function Assert-Match([string]$Text, [string]$Pattern, [string]$Message) {
  if ($Text -notmatch $Pattern) { throw $Message }
}

function Assert-NotMatch([string]$Text, [string]$Pattern, [string]$Message) {
  if ($Text -match $Pattern) { throw $Message }
}

$candidateValues = if ([IO.Path]::IsPathRooted($ValuesFile)) { $ValuesFile } else { Join-Path (Get-Location).Path $ValuesFile }
$resolvedValues = [IO.Path]::GetFullPath($candidateValues)
if (!(Test-Path -LiteralPath $resolvedValues -PathType Leaf)) { throw "Values file does not exist: $resolvedValues" }
$helm = Resolve-HelmExecutable
$source = Get-Content -LiteralPath $resolvedValues -Raw
$arguments = @('template', 'lifeops', $chart, '--namespace', 'lifeops', '--values', $resolvedValues)
$releaseDigestState = 'not-checked'

if ($Production) {
  $digestMatches = [regex]::Matches($source, '(?m)^\s{4}digest:\s*"?(?<digest>sha256:[a-f0-9]{64})"?\s*$')
  $emptyDigestCount = [regex]::Matches($source, '(?m)^\s{4}digest:\s*""\s*$').Count
  if ($digestMatches.Count -eq 2) {
    $releaseDigestState = 'configured'
  } elseif ($digestMatches.Count -eq 0 -and $emptyDigestCount -eq 2) {
    # P6-T2 validates the production render contract before P6-T6 is allowed to
    # publish. These values exist only in this in-memory Helm invocation and
    # must never be reported as release or registry evidence.
    $arguments += @(
      '--set-string', 'web.image.digest=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      '--set-string', 'api.image.digest=sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
    )
    $releaseDigestState = 'render-contract-fixture-release-pending'
  } else {
    throw 'Production values must contain either two empty pre-release digest fields or two valid sha256 release digests.'
  }
}

$rendered = & $helm @arguments 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "Helm render failed:`n$rendered" }

Assert-NotMatch $rendered '(?m)^\s*hostPath:|^\s*privileged:\s*true' 'Rendered workloads may not use hostPath or privileged containers.'
Assert-NotMatch $rendered '(?m)^\s*automountServiceAccountToken:\s*true' 'Implicit ServiceAccount token mounting is forbidden.'
Assert-NotMatch $rendered '(?ms)name:\s*(?:MYSQL_PASSWORD|MYSQL_ROOT_PASSWORD|LIFEOPS_ADMIN_PASSWORD|AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY)\s+value:\s*' 'Credential environment variables must use secretKeyRef.'

$clusterRole = ([regex]::Split($rendered, '(?m)^---\s*$') | Where-Object { $_ -match '(?m)^kind:\s*ClusterRole\s*$' }) -join "`n"
if ($clusterRole) {
  Assert-NotMatch $clusterRole '(?m)^\s*-\s*"?\*"?\s*$|^\s*nonResourceURLs:' 'ClusterRole contains wildcard or non-resource access.'
  Assert-NotMatch $clusterRole '(?i)(?:secrets|pods/log|pods/exec|impersonate|create|update|patch|delete|deletecollection|watch)' 'ClusterRole exceeds the approved read-only resource surface.'
  foreach ($required in @('nodes', 'pods', 'services', 'namespaces', 'deployments', 'statefulsets', 'daemonsets', 'replicasets', 'httproutes', 'gateways')) {
    Assert-Match $clusterRole "(?m)^\s*-\s*$required\s*$" "ClusterRole is missing approved resource $required."
  }
}

$workloads = [regex]::Split($rendered, '(?m)^---\s*$') | Where-Object { $_ -match '(?m)^kind:\s*(?:Deployment|StatefulSet|Job)\s*$' }
if ($workloads.Count -lt 4) { throw 'Expected Web, API, MySQL and migration workloads in the rendered chart.' }
$mysqlWorkload = $workloads | Where-Object { $_ -match '(?ms)^kind:\s*StatefulSet\s*$.*app\.kubernetes\.io/component:\s*mysql\s*$' } | Select-Object -First 1
Assert-Match $mysqlWorkload '(?m)^\s*-\s*--log-bin-trust-function-creators=1\s*$' 'MySQL must permit version-controlled trigger migrations without global app-user privileges.'
foreach ($workload in $workloads) {
  Assert-Match $workload '(?m)^\s*automountServiceAccountToken:\s*false\s*$' 'Every workload must disable implicit ServiceAccount tokens.'
  Assert-Match $workload '(?ms)runAsNonRoot:\s*true.*runAsUser:\s*[1-9]\d*.*runAsGroup:\s*[1-9]\d*.*seccompProfile:\s*\r?\n\s*type:\s*RuntimeDefault' 'Every workload must use numeric non-root identity and RuntimeDefault seccomp.'
  Assert-Match $workload '(?ms)allowPrivilegeEscalation:\s*false.*readOnlyRootFilesystem:\s*true.*drop:\s*\["ALL"\]' 'Every workload container must be read-only and drop ALL capabilities.'
  Assert-Match $workload '(?ms)resources:.*requests:.*cpu:.*memory:.*limits:.*cpu:.*memory:|resources:.*limits:.*cpu:.*memory:.*requests:.*cpu:.*memory:' 'Every workload must have CPU and memory requests and limits.'
}

if ($Production) {
  Assert-NotMatch $source '(?m)^\s+(?:adminPassword|mysqlPassword|mysqlRootPassword):\s*\S+' 'Production values contain inline secret data.'
  Assert-NotMatch $rendered '(?m)^kind:\s*Secret\s*$|^stringData:' 'Production rendering may not create an inline Secret.'
  $images = [regex]::Matches($rendered, '(?m)^\s*image:\s*"?[^\s"@]+@sha256:[a-f0-9]{64}"?\s*$')
  if ($images.Count -lt 2) { throw 'Production render must contain digest-pinned Web and API images.' }
  $policies = [regex]::Matches($rendered, '(?m)^kind:\s*NetworkPolicy\s*$')
  if ($policies.Count -lt 4) { throw 'Production render must include default and component NetworkPolicies.' }
}

Write-Output "rendered-helm-validation: ok; release-digests=$releaseDigestState"
