param()

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$failures = [Collections.Generic.List[string]]::new()
function Add-Failure([bool]$Condition, [string]$Message) {
  if (!$Condition) { $script:failures.Add($Message) }
}

$ci = Get-Content -LiteralPath (Join-Path $workspace '.github/workflows/ci.yml') -Raw
$release = Get-Content -LiteralPath (Join-Path $workspace '.github/workflows/release.yml') -Raw
$webDockerfile = Get-Content -LiteralPath (Join-Path $workspace 'Dockerfile') -Raw
$apiDockerfile = Get-Content -LiteralPath (Join-Path $workspace 'server/Dockerfile') -Raw
$allWorkflows = "$ci`n$release"

$uses = [regex]::Matches($allWorkflows, '(?m)^\s*-\s*uses:\s*([^\s#]+)(?:\s+#\s*(.+))?\s*$')
Add-Failure ($uses.Count -gt 0) 'Workflows must contain pinned actions.'
foreach ($use in $uses) {
  Add-Failure ($use.Groups[1].Value -match '@[a-f0-9]{40}$') "Action must use a full 40-character commit SHA: $($use.Groups[1].Value)"
  Add-Failure ($use.Groups[2].Value -match '^v?\d+(?:\.\d+){0,2}') "Pinned action must retain its human-readable release tag comment: $($use.Groups[1].Value)"
}

Add-Failure ($ci -match '(?m)^permissions:\s*\r?\n\s+contents:\s*read\s*$') 'CI must declare minimum read-only contents permission.'
Add-Failure ($release -match '(?m)^permissions:\s*\r?\n\s+contents:\s*write\s*$') 'Release must declare only the contents permission required for the GitOps commit.'
Add-Failure ($ci -match '(?m)^concurrency:\s*$') 'CI must define concurrency cancellation for superseded branch/PR runs.'
Add-Failure ($release -match '(?m)^concurrency:\s*$') 'Release must serialize production publication.'
foreach ($document in @($ci, $release)) {
  Add-Failure ($document -match '(?m)^\s+timeout-minutes:\s*[1-9][0-9]*\s*$') 'Every workflow job must have a finite timeout.'
  $timeoutMatch = [regex]::Match($document, '(?m)^\s+timeout-minutes:\s*([1-9][0-9]*)\s*$')
  Add-Failure ($timeoutMatch.Success -and [int]$timeoutMatch.Groups[1].Value -ge 90) 'Workflow timeout must accommodate the complete serial browser matrix.'
  Add-Failure ($document -notmatch '(?ms)options:\s*>-.*?--log-bin-trust-function-creators=1') 'MySQL server arguments must not be placed in service options where Docker treats them as docker create flags.'
  $trustIndex = $document.IndexOf('Configure MySQL trigger migration trust', [StringComparison]::Ordinal)
  $mysqlIndex = $document.IndexOf('Real MySQL 8.4 store integration', [StringComparison]::Ordinal)
  Add-Failure ($trustIndex -ge 0 -and $mysqlIndex -gt $trustIndex) 'Workflow must configure MySQL trigger migration trust after service startup and before integration migrations.'
  Add-Failure ($document -match 'SET GLOBAL log_bin_trust_function_creators\s*=\s*1') 'Workflow must enable only the required MySQL global before migrations.'
}

foreach ($required in @(
  'npm ci', 'npm ci --prefix server', 'npm test', 'npm run test:server', 'npm run test:mysql',
  'npm run typecheck', 'npm run typecheck:server', 'npm run build', 'npm run build:server',
  'npm run test:e2e', 'npm run test:e2e:remote', 'helm lint', 'helm template', 'validate-workflows.ps1'
)) {
  Add-Failure ($ci -match [regex]::Escape($required)) "CI is missing required gate: $required"
}
Add-Failure ($ci -match '(?i)accessib|a11y') 'CI must name or invoke the accessibility acceptance gate explicitly.'

foreach ($dockerfile in @($webDockerfile, $apiDockerfile)) {
  foreach ($from in [regex]::Matches($dockerfile, '(?m)^FROM\s+([^\s]+)')) {
    Add-Failure ($from.Groups[1].Value -notmatch ':(?:latest|edge|stable|[0-9]+)$') "Container base must use an exact non-floating tag: $($from.Groups[1].Value)"
  }
}
Add-Failure ($webDockerfile -match 'org\.opencontainers\.image\.revision=') 'Web image must accept an OCI revision label at build time.'
Add-Failure ($webDockerfile -match 'org\.opencontainers\.image\.source=') 'Web image must accept an OCI source label at build time.'
Add-Failure ($apiDockerfile -match 'org\.opencontainers\.image\.revision=') 'API image must accept an OCI revision label at build time.'
Add-Failure ($apiDockerfile -match 'org\.opencontainers\.image\.source=') 'API image must accept an OCI source label at build time.'

Add-Failure ($release -match '--platform\s+linux/amd64') 'Release must build the approved linux/amd64 images.'
Add-Failure ($release -match '--provenance(?:=true)?') 'Release must emit provenance attestations.'
Add-Failure ($release -match '--sbom(?:=true)?') 'Release must emit SBOM attestations.'
Add-Failure ($release -match '--password-stdin') 'UHub login must use password-stdin.'
$inRunBlock = $false
$runIndent = 0
foreach ($line in ($release -split '\r?\n')) {
  if ($line -match '^(\s*)run:\s*(.*)$') {
    $runIndent = $Matches[1].Length
    $inRunBlock = $Matches[2].Trim() -in @('|', '|-', '>', '>-')
    if ($Matches[2] -match '\$\{\{\s*secrets\.') {
      $failures.Add('Secrets must enter commands through an env binding, never workflow expression interpolation in command arguments.')
      break
    }
    continue
  }
  if ($inRunBlock) {
    $indent = ([regex]::Match($line, '^\s*').Value).Length
    if ($line.Trim() -and $indent -le $runIndent) { $inRunBlock = $false }
    elseif ($line -match '\$\{\{\s*secrets\.') {
      $failures.Add('Secrets must enter commands through an env binding, never workflow expression interpolation in command arguments.')
      break
    }
  }
}
$smokeIndex = $release.IndexOf('smoke-images.ps1', [StringComparison]::Ordinal)
$updateIndex = $release.IndexOf('update-gitops-values.mjs', [StringComparison]::Ordinal)
Add-Failure ($smokeIndex -ge 0) 'Release must execute the exact-digest image smoke script.'
Add-Failure ($updateIndex -ge 0 -and $smokeIndex -ge 0 -and $smokeIndex -lt $updateIndex) 'Both exact-digest smokes must pass before GitOps values are updated.'

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot ("lifeops-gitops-contract-" + [guid]::NewGuid().ToString('N')))
try {
  $duplicate = Join-Path $temp.FullName 'duplicate.yaml'
  @'
web:
  image:
    digest: ""
web:
  image:
    digest: ""
api:
  image:
    digest: ""
'@ | Set-Content -LiteralPath $duplicate -Encoding UTF8
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $duplicateOutput = & node (Join-Path $PSScriptRoot 'update-gitops-values.mjs') $duplicate ('sha256:' + ('a' * 64)) ('sha256:' + ('b' * 64)) 2>&1 | Out-String
  $duplicateExit = $LASTEXITCODE
  $ErrorActionPreference = $previous
  Add-Failure ($duplicateExit -ne 0) "GitOps updater must reject duplicate section/digest keys. Output: $duplicateOutput"
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected temp path: $resolvedTemp" }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}

$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$validatorOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'validate-workflows.ps1') -WorkspaceRoot $workspace 2>&1 | Out-String
$validatorExit = $LASTEXITCODE
$ErrorActionPreference = $previous
Add-Failure ($validatorExit -eq 0) "Standalone workflow validator must accept the repository. Output: $validatorOutput"

if ($failures.Count -gt 0) { throw ("workflow-contract failed:`n- " + ($failures -join "`n- ")) }
Write-Output 'workflow-contract: ok'
