param(
  [string]$Manifest = '',
  [switch]$ArtifactOnly
)

$ErrorActionPreference = 'Stop'

if (!$Manifest) { $Manifest = 'outputs/final/release-manifest.json' }
$manifestPath = [IO.Path]::GetFullPath($Manifest)
if (!(Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'RELEASE_MANIFEST_MISSING' }
try {
  $document = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
} catch {
  throw 'RELEASE_MANIFEST_INVALID_JSON'
}

function Require([bool]$Condition, [string]$Code) {
  if (!$Condition) { throw $Code }
}

function Invoke-Docker([string[]]$Arguments) {
  # Formal registry verification uses docker buildx imagetools inspect.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & docker @Arguments 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($exitCode -ne 0) { throw 'REGISTRY_INSPECT_FAILED' }
  return $output.Trim()
}

Require ($document.schemaVersion -eq 1) 'RELEASE_MANIFEST_SCHEMA_INVALID'
Require ([string]$document.sourceRevision -match '^[a-f0-9]{40}$') 'SOURCE_REVISION_INVALID'
Require ([string]$document.testCheckpoint -match '^[A-Fa-f0-9]{64}$') 'TEST_CHECKPOINT_INVALID'

foreach ($name in @('web', 'api')) {
  $image = $document.images.$name
  Require ($null -ne $image) "IMAGE_RECORD_MISSING:$name"
  $digest = [string]$image.digest
  $immutableReference = [string]$image.immutableReference
  Require ($digest -match '^sha256:[a-f0-9]{64}$') "IMAGE_DIGEST_INVALID:$name"
  Require ($immutableReference.EndsWith("@$digest", [StringComparison]::Ordinal) -and $immutableReference.Length -gt $digest.Length + 1) "IMMUTABLE_REFERENCE_INVALID:$name"
  foreach ($attestationName in @('sbom', 'provenance')) {
    $attestation = $image.$attestationName
    Require ($attestation.verified -eq $true) "ATTESTATION_UNVERIFIED:${name}:$attestationName"
    Require ([string]$attestation.digest -eq $digest) "ATTESTATION_SUBJECT_MISMATCH:${name}:$attestationName"
  }

  if (!$ArtifactOnly) {
    $resolved = Invoke-Docker @('buildx', 'imagetools', 'inspect', $immutableReference, '--format', '{{json .Manifest.Digest}}')
    $resolvedDigest = $resolved.Trim('"')
    Require ($resolvedDigest -eq $digest) "REGISTRY_DIGEST_MISMATCH:$name"
    foreach ($attestationName in @('sbom', 'provenance')) {
      $attestationDigest = [string]$image.$attestationName.attestationDigest
      Require ($attestationDigest -match '^sha256:[a-f0-9]{64}$') "ATTESTATION_DIGEST_INVALID:${name}:$attestationName"
      $repository = $immutableReference.Substring(0, $immutableReference.LastIndexOf('@'))
      $raw = Invoke-Docker @('buildx', 'imagetools', 'inspect', "$repository@$attestationDigest", '--raw')
      Require ($raw.Length -gt 0) "ATTESTATION_INSPECT_EMPTY:${name}:$attestationName"
    }
  }
}

foreach ($artifact in @($document.artifacts)) {
  $artifactPath = [IO.Path]::GetFullPath([string]$artifact.path)
  $artifactSha256 = [string]$artifact.artifactSha256
  Require ($artifactSha256 -match '^[A-Fa-f0-9]{64}$') "ARTIFACT_HASH_INVALID:$artifactPath"
  Require (Test-Path -LiteralPath $artifactPath -PathType Leaf) "ARTIFACT_MISSING:$artifactPath"
  $actual = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash
  Require ($actual -eq $artifactSha256.ToUpperInvariant()) "ARTIFACT_HASH_MISMATCH:$artifactPath"
}

Write-Output "release-manifest: images=2 artifacts=$(@($document.artifacts).Count)"
Write-Output 'RELEASE_MANIFEST_OK'
