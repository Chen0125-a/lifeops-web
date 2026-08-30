param([string]$HelmExecutable = '')

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$validator = Join-Path $PSScriptRoot 'validate-deployment-package.ps1'
$failures = [Collections.Generic.List[string]]::new()

function Require([bool]$Condition, [string]$Message) {
  if (!$Condition) { $script:failures.Add($Message) }
}

function Resolve-Helm {
  if ($HelmExecutable) { return $HelmExecutable }
  $command = Get-Command helm -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $packages = Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages'
  $candidate = Get-ChildItem -LiteralPath $packages -Recurse -Filter helm.exe -File -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (!$candidate) { throw 'Helm is required for the deployment-package contract test.' }
  return $candidate
}

function Invoke-Validator([string]$Manifest, [string]$Values, [string]$Summary, [string]$Checklist = '') {
  $arguments = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $validator,
    '-ReleaseManifest', $Manifest,
    '-ValuesFile', $Values,
    '-SummaryPath', $Summary,
    '-HelmExecutable', $script:helm
  )
  if ($Checklist) { $arguments += @('-ChecklistPath', $Checklist) }
  $prior = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & powershell.exe @arguments 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $prior
  return @{ Output = $output; ExitCode = $exitCode }
}

Require (Test-Path -LiteralPath $validator -PathType Leaf) 'Deployment-package validator must exist.'
if (!(Test-Path -LiteralPath $validator -PathType Leaf)) {
  throw ("deployment-package-contract failed:`n- " + ($failures -join "`n- "))
}

$source = Get-Content -LiteralPath $validator -Raw
$checklistSource = Get-Content -LiteralPath (Join-Path $workspace 'docs/runbooks/user-deployment-checklist.md') -Raw
foreach ($token in @(
  'verify-release-manifest.ps1', 'validate-rendered-helm.ps1', 'validate-media-topology.ps1',
  'DEPLOYMENT_PACKAGE_FILE_MISSING', 'DEPLOYMENT_PACKAGE_RELEASE_MANIFEST_INVALID',
  'DEPLOYMENT_PACKAGE_DIGEST_MISMATCH', 'DEPLOYMENT_PACKAGE_PLACEHOLDER',
  'DEPLOYMENT_PACKAGE_SECRET_VALUE', 'DEPLOYMENT_PACKAGE_MEDIA_TOPOLOGY',
  'DEPLOYMENT_PACKAGE_PUBLIC_METRICS', 'DEPLOYMENT_PACKAGE_RBAC',
  'DEPLOYMENT_PACKAGE_MANUAL_SECTION', 'DEPLOYMENT_PACKAGE_COMMAND_SAFETY',
  'DEPLOYMENT_PACKAGE_ASSET_MAPPING'
)) {
  Require ($source -match [regex]::Escape($token)) "Validator is missing stable contract token: $token"
}
Require ($source -notmatch '\b(?:kubectl|helm\s+(?:install|upgrade)|argocd\s+app\s+sync)\b') 'Offline validator must not contain cluster mutation commands.'
Require ($checklistSource -notmatch '--docker-password(?:-file)?(?:=|\s)') 'The handoff must not place registry credentials or unsupported password-file flags on the command line.'
Require ($checklistSource -match '--from-file=\.dockerconfigjson=<PRIVATE_DOCKER_CONFIG_JSON>') 'The imagePullSecret example must import a private Docker config file through the supported .dockerconfigjson key.'

$script:helm = Resolve-Helm
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot ('lifeops-deployment-package-test-' + [guid]::NewGuid().ToString('N')))
try {
  $manifestPath = Join-Path $workspace 'outputs/final/release-manifest.json'
  $valuesPath = Join-Path $workspace 'deploy/gitops/environments/production/values.yaml'
  $summaryPath = Join-Path $temp.FullName 'summary.md'
  $valid = Invoke-Validator $manifestPath $valuesPath $summaryPath
  Require ($valid.ExitCode -eq 0) "The current offline deployment package must pass. Output: $($valid.Output)"
  Require (Test-Path -LiteralPath $summaryPath -PathType Leaf) 'A passing validation must write the sanitized summary.'
  if (Test-Path -LiteralPath $summaryPath -PathType Leaf) {
    $summary = Get-Content -LiteralPath $summaryPath -Raw
    Require ($summary -match 'deployment-package-validation: ok') 'Summary must record the stable success marker.'
    Require ($summary -notmatch '(?i)(?:password|token|cookie)\s*[:=]\s*\S+') 'Summary must not serialize credential-shaped values.'
  }

  $badManifestPath = Join-Path $temp.FullName 'bad-manifest.json'
  $badManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $badManifest.images.web.digest = 'sha256:' + ('b' * 64)
  $badManifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $badManifestPath -Encoding UTF8
  $badManifestResult = Invoke-Validator $badManifestPath $valuesPath (Join-Path $temp.FullName 'bad-manifest-summary.md')
  Require ($badManifestResult.ExitCode -ne 0) 'A digest-inconsistent release manifest must fail.'
  Require ($badManifestResult.Output -match 'DEPLOYMENT_PACKAGE_RELEASE_MANIFEST_INVALID|DEPLOYMENT_PACKAGE_DIGEST_MISMATCH') 'Manifest drift must use a stable package code.'

  $placeholderValuesPath = Join-Path $temp.FullName 'placeholder-values.yaml'
  (Get-Content -LiteralPath $valuesPath -Raw).Replace(
    'sha256:31d13ed140d0f3343bbef40355e736ce8d63298ffa3c3efb97f27659fb9fa4af',
    '<WEB_DIGEST>'
  ) | Set-Content -LiteralPath $placeholderValuesPath -Encoding UTF8
  $placeholderResult = Invoke-Validator $manifestPath $placeholderValuesPath (Join-Path $temp.FullName 'placeholder-summary.md')
  Require ($placeholderResult.ExitCode -ne 0) 'A deployable digest placeholder must fail.'
  Require ($placeholderResult.Output -match 'DEPLOYMENT_PACKAGE_PLACEHOLDER') 'A deployable placeholder must use the stable package code.'

  $secretValuesPath = Join-Path $temp.FullName 'secret-values.yaml'
  ((Get-Content -LiteralPath $valuesPath -Raw) + "`nsecrets:`n  create: true`n  data:`n    adminPassword: forbidden-fixture-value`n") |
    Set-Content -LiteralPath $secretValuesPath -Encoding UTF8
  $secretResult = Invoke-Validator $manifestPath $secretValuesPath (Join-Path $temp.FullName 'secret-summary.md')
  Require ($secretResult.ExitCode -ne 0) 'An inline production Secret value must fail.'
  Require ($secretResult.Output -match 'DEPLOYMENT_PACKAGE_SECRET_VALUE') 'Inline Secret rejection must use the stable package code.'
  Require ($secretResult.Output -notmatch 'forbidden-fixture-value') 'Rejected Secret values must not be echoed.'

  $unsafeMediaValuesPath = Join-Path $temp.FullName 'unsafe-media-values.yaml'
  @'
production: true
web:
  image:
    repository: uhub.service.ucloud.cn/chenucloud/lifeops-web
    digest: sha256:31d13ed140d0f3343bbef40355e736ce8d63298ffa3c3efb97f27659fb9fa4af
api:
  replicaCount: 2
  image:
    repository: uhub.service.ucloud.cn/chenucloud/lifeops-api
    digest: sha256:c70d0b33612e36c171c4085639e8cf7d558abdbd37b780fb0bd651a4e7c9c5e3
media:
  backend: filesystem
  filesystem:
    persistence:
      enabled: true
      accessModes:
        - ReadWriteOnce
'@ | Set-Content -LiteralPath $unsafeMediaValuesPath -Encoding UTF8
  $unsafeMedia = Invoke-Validator $manifestPath $unsafeMediaValuesPath (Join-Path $temp.FullName 'unsafe-media-summary.md')
  Require ($unsafeMedia.ExitCode -ne 0) 'Multi-replica API plus RWO filesystem media must fail.'
  Require ($unsafeMedia.Output -match 'DEPLOYMENT_PACKAGE_MEDIA_TOPOLOGY') 'Unsafe media topology must use the stable package code.'

  $missingChecklist = Invoke-Validator $manifestPath $valuesPath (Join-Path $temp.FullName 'missing-doc-summary.md') (Join-Path $temp.FullName 'missing-checklist.md')
  Require ($missingChecklist.ExitCode -ne 0) 'A missing required runbook must fail.'
  Require ($missingChecklist.Output -match 'DEPLOYMENT_PACKAGE_FILE_MISSING') 'Missing runbooks must use the stable package code.'
} finally {
  $resolved = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected temp path: $resolved" }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

if ($failures.Count -gt 0) { throw ("deployment-package-contract failed:`n- " + ($failures -join "`n- ")) }
Write-Output 'deployment-package-contract: ok'
