param(
  [string]$Version = '',
  [string]$Workflow = '.github/workflows/release.yml',
  [switch]$Wait,
  [string]$RepositoryRoot = '',
  [string]$ManifestPath = 'outputs/final/release-manifest.json'
)

$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+(?:[-.][0-9A-Za-z.-]+)?$') {
  throw 'INVALID_SEMVER'
}

if (!$RepositoryRoot) { $RepositoryRoot = Split-Path -Parent $PSScriptRoot }
$RepositoryRoot = [IO.Path]::GetFullPath($RepositoryRoot)
$manifestFile = if ([IO.Path]::IsPathRooted($ManifestPath)) { $ManifestPath } else { Join-Path $RepositoryRoot $ManifestPath }
$manifestFile = [IO.Path]::GetFullPath($manifestFile)
$finalRoot = [IO.Path]::GetFullPath((Join-Path $RepositoryRoot 'outputs/final'))
if (!$manifestFile.StartsWith($finalRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'RELEASE_MANIFEST_PATH_OUTSIDE_OUTPUTS_FINAL' }
$summaryFile = Join-Path $finalRoot 'release-summary.md'
$valuesRelative = 'deploy/gitops/environments/production/values.yaml'
$valuesFile = Join-Path $RepositoryRoot $valuesRelative
$webRepository = 'uhub.service.ucloud.cn/chenucloud/lifeops-web'
$apiRepository = 'uhub.service.ucloud.cn/chenucloud/lifeops-api'

function Invoke-Native([string]$Operation, [string]$Executable, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & $Executable @Arguments 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($exitCode -ne 0) {
    $marker = [regex]::Match($output, '\b(?:RELEASE|IMAGE|ATTESTATION|MIGRATION)_[A-Z0-9_.:=-]{1,160}\b').Value
    $diagnostic = if ($marker) { " Diagnostic: $marker." } else { '' }
    throw "Operation '$Operation' failed with exit code $exitCode.$diagnostic"
  }
  return $output.Trim()
}

function Invoke-Gh([string]$Operation, [string[]]$Arguments) {
  return Invoke-Native $Operation 'gh' $Arguments
}

function Invoke-Git([string]$Operation, [string[]]$Arguments) {
  return Invoke-Native $Operation 'git' $Arguments
}

function Invoke-Docker([string]$Operation, [string[]]$Arguments) {
  return Invoke-Native $Operation 'docker' $Arguments
}

function Get-ImageEvidence([string]$Repository, [string]$ReleaseVersion) {
  # Formal registry resolution uses docker buildx imagetools inspect.
  $taggedReference = "${Repository}:$ReleaseVersion"
  $digestOutput = Invoke-Docker "resolve digest for $Repository" @('buildx', 'imagetools', 'inspect', $taggedReference, '--format', '{{json .Manifest.Digest}}')
  $digest = $digestOutput.Trim('"')
  if ($digest -notmatch '^sha256:[a-f0-9]{64}$') { throw "IMAGE_DIGEST_INVALID:$Repository" }

  $rawIndex = Invoke-Docker "inspect attestation index for $Repository" @('buildx', 'imagetools', 'inspect', $taggedReference, '--raw')
  try { $index = $rawIndex | ConvertFrom-Json } catch { throw "IMAGE_INDEX_INVALID:$Repository" }
  $sbomDigest = ''
  $provenanceDigest = ''
  foreach ($descriptor in @($index.manifests)) {
    $annotations = $descriptor.annotations
    if ([string]$annotations.'vnd.docker.reference.type' -ne 'attestation-manifest') { continue }
    $attestationDigest = [string]$descriptor.digest
    if ($attestationDigest -notmatch '^sha256:[a-f0-9]{64}$') { continue }
    $rawAttestation = Invoke-Docker "inspect attestation $attestationDigest" @('buildx', 'imagetools', 'inspect', "$Repository@$attestationDigest", '--raw')
    try { $attestation = $rawAttestation | ConvertFrom-Json } catch { throw "ATTESTATION_MANIFEST_INVALID:$Repository" }
    foreach ($layer in @($attestation.layers)) {
      $predicateType = [string]$layer.annotations.'in-toto.io/predicate-type'
      if ($predicateType -match '(?i)spdx') { $sbomDigest = $attestationDigest }
      if ($predicateType -match '(?i)slsa.*provenance') { $provenanceDigest = $attestationDigest }
    }
  }
  if (!$sbomDigest) { throw "SBOM_ATTESTATION_MISSING:$Repository" }
  if (!$provenanceDigest) { throw "PROVENANCE_ATTESTATION_MISSING:$Repository" }
  return [ordered]@{
    taggedReference = $taggedReference
    immutableReference = "$Repository@$digest"
    digest = $digest
    sbom = [ordered]@{ verified = $true; digest = $digest; attestationDigest = $sbomDigest }
    provenance = [ordered]@{ verified = $true; digest = $digest; attestationDigest = $provenanceDigest }
  }
}

function Get-ArtifactRecord([string]$RelativePath) {
  $path = Join-Path $RepositoryRoot $RelativePath
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) { throw "RELEASE_ARTIFACT_MISSING:$RelativePath" }
  return [ordered]@{ path = $RelativePath.Replace('\\', '/'); artifactSha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
}

Push-Location $RepositoryRoot
try {
  $gitRoot = Invoke-Git 'resolve Git root' @('rev-parse', '--show-toplevel')
  if ([IO.Path]::GetFullPath($gitRoot) -ne $RepositoryRoot) { throw 'RELEASE_GIT_ROOT_MISMATCH' }
  $dirty = Invoke-Git 'check clean worktree' @('status', '--porcelain')
  if ($dirty) { throw 'RELEASE_WORKTREE_NOT_CLEAN' }
  $sourceRevision = Invoke-Git 'resolve sourceRevision' @('rev-parse', 'HEAD')
  if ($sourceRevision -notmatch '^[a-f0-9]{40}$') { throw 'SOURCE_REVISION_INVALID' }
  $branch = Invoke-Git 'resolve source branch' @('branch', '--show-current')
  if (!$branch) { throw 'RELEASE_DETACHED_HEAD' }

  $repository = (Invoke-Gh 'resolve GitHub repository' @('repo', 'view', '--json', 'nameWithOwner') | ConvertFrom-Json).nameWithOwner
  $secretNames = @((Invoke-Gh 'list GitHub secret names' @('secret', 'list', '--repo', $repository, '--json', 'name') | ConvertFrom-Json) | ForEach-Object { $_.name })
  foreach ($requiredSecret in @('UHUB_USERNAME', 'UHUB_PASSWORD')) {
    if ($secretNames -notcontains $requiredSecret) { throw "GITHUB_SECRET_MISSING:$requiredSecret" }
  }

  $existingRuns = @(Invoke-Gh 'list existing release runs' @('run', 'list', '--repo', $repository, '--workflow', $Workflow, '--event', 'workflow_dispatch', '--limit', '100', '--json', 'databaseId') | ConvertFrom-Json)
  $existingIds = [Collections.Generic.HashSet[long]]::new()
  foreach ($run in $existingRuns) { $null = $existingIds.Add([long]$run.databaseId) }

  # Dispatch contract: gh workflow run <workflow> --ref <branch> -f version=<SemVer>.
  $null = Invoke-Gh 'dispatch release workflow' @('workflow', 'run', $Workflow, '--repo', $repository, '--ref', $branch, '-f', "version=$Version")
  $releaseRun = $null
  for ($attempt = 0; $attempt -lt 30 -and !$releaseRun; $attempt++) {
    Start-Sleep -Seconds 2
    $runs = @(Invoke-Gh 'locate dispatched release run' @('run', 'list', '--repo', $repository, '--workflow', $Workflow, '--event', 'workflow_dispatch', '--branch', $branch, '--limit', '20', '--json', 'databaseId,headSha,status,conclusion,createdAt,url') | ConvertFrom-Json)
    $releaseRun = $runs | Where-Object { $_.headSha -eq $sourceRevision -and !$existingIds.Contains([long]$_.databaseId) } | Sort-Object databaseId -Descending | Select-Object -First 1
  }
  if (!$releaseRun) { throw 'RELEASE_RUN_NOT_FOUND' }

  if ($Wait) {
    # Wait contract: gh run watch <id> --exit-status.
    $null = Invoke-Gh 'wait for release workflow' @('run', 'watch', [string]$releaseRun.databaseId, '--repo', $repository, '--exit-status')
  }
  $runView = Invoke-Gh 'read completed release run' @('run', 'view', [string]$releaseRun.databaseId, '--repo', $repository, '--json', 'databaseId,headSha,status,conclusion,url,jobs') | ConvertFrom-Json
  if ($Wait -and ($runView.status -ne 'completed' -or $runView.conclusion -ne 'success')) { throw 'RELEASE_WORKFLOW_NOT_SUCCESSFUL' }
  if ($runView.headSha -ne $sourceRevision) { throw 'RELEASE_RUN_REVISION_MISMATCH' }
  $smokeStep = @($runView.jobs | ForEach-Object { $_.steps } | Where-Object { $_.name -eq 'Smoke exact registry digests' })
  if ($smokeStep.Count -ne 1 -or $smokeStep[0].conclusion -ne 'success') { throw 'EXACT_DIGEST_SMOKE_NOT_VERIFIED' }

  $web = Get-ImageEvidence $webRepository $Version
  $api = Get-ImageEvidence $apiRepository $Version

  $null = Invoke-Git 'fetch GitOps digest update' @('fetch', 'origin', $branch)
  $dirtyAfterRun = Invoke-Git 'recheck clean worktree' @('status', '--porcelain')
  if ($dirtyAfterRun) { throw 'RELEASE_WORKTREE_DIRTY_BEFORE_SYNC' }
  $null = Invoke-Git 'fast-forward GitOps digest update' @('merge', '--ff-only', "origin/$branch")
  $values = Get-Content -LiteralPath $valuesFile -Raw
  foreach ($digest in @($web.digest, $api.digest)) {
    if ($values -notmatch [regex]::Escape($digest)) { throw "GITOPS_DIGEST_MISSING:$digest" }
  }

  $checkpointFile = Get-ChildItem -LiteralPath (Join-Path $RepositoryRoot 'outputs/evidence/source-checkpoints') -Filter '*.json' |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (!$checkpointFile) { throw 'TEST_CHECKPOINT_MISSING' }
  $checkpoint = Get-Content -LiteralPath $checkpointFile.FullName -Raw | ConvertFrom-Json
  $testCheckpoint = [string]$checkpoint.rootSha256
  if ($testCheckpoint -notmatch '^[A-Fa-f0-9]{64}$') { throw 'TEST_CHECKPOINT_INVALID' }

  $summary = @"
# LifeOps production release

- Result: PASS
- Version: ``$Version``
- Source revision: ``$sourceRevision``
- GitHub run: $($runView.url)
- Web: ``$($web.immutableReference)``
- API: ``$($api.immutableReference)``
- Exact-digest smoke: verified in GitHub Actions
- SBOM and provenance: registry attestations verified for both images
"@
  $null = New-Item -ItemType Directory -Path $finalRoot -Force
  [IO.File]::WriteAllText($summaryFile, $summary.TrimStart(), [Text.UTF8Encoding]::new($false))

  $artifacts = @(
    Get-ArtifactRecord 'outputs/final/release-preflight-summary.md'
    Get-ArtifactRecord 'outputs/final/data-rehearsal-summary.md'
    Get-ArtifactRecord 'outputs/final/release-summary.md'
    Get-ArtifactRecord $valuesRelative
    Get-ArtifactRecord ([IO.Path]::GetRelativePath($RepositoryRoot, $checkpointFile.FullName))
  )
  $manifest = [ordered]@{
    schemaVersion = 1
    version = $Version
    sourceRevision = $sourceRevision
    testCheckpoint = $testCheckpoint.ToUpperInvariant()
    github = [ordered]@{ repository = $repository; runId = [long]$runView.databaseId; runUrl = $runView.url; conclusion = $runView.conclusion }
    images = [ordered]@{ web = $web; api = $api }
    artifacts = $artifacts
  }
  [IO.File]::WriteAllText($manifestFile, ($manifest | ConvertTo-Json -Depth 12), [Text.UTF8Encoding]::new($false))
  Write-Output "release-production: version=$Version run=$($runView.databaseId)"
  Write-Output "web: $($web.immutableReference)"
  Write-Output "api: $($api.immutableReference)"
  Write-Output "manifest: $manifestFile"
  Write-Output 'RELEASE_PRODUCTION_OK'
} finally {
  Pop-Location
}
