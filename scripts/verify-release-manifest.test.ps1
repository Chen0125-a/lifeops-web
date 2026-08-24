param()

$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'verify-release-manifest.ps1'
$failures = [Collections.Generic.List[string]]::new()
function Require([bool]$Condition, [string]$Message) { if (!$Condition) { $script:failures.Add($Message) } }
function Invoke-Verify([string]$ManifestPath) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Manifest $ManifestPath -ArtifactOnly 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previous
  return @{ Output = $output; ExitCode = $exitCode }
}

Require (Test-Path -LiteralPath $scriptPath -PathType Leaf) 'Release-manifest verifier must be loadable.'
$source = Get-Content -LiteralPath $scriptPath -Raw
foreach ($token in @('artifactSha256', 'sourceRevision', 'testCheckpoint', 'immutableReference', 'sbom', 'provenance', 'imagetools inspect')) {
  Require ($source -match [regex]::Escape($token)) "Release-manifest verifier contract is missing token: $token"
}

$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot ('lifeops-release-manifest-test-' + [guid]::NewGuid().ToString('N')))
try {
  $artifact = Join-Path $temp.FullName 'artifact.txt'
  'lifeops-release-artifact' | Set-Content -LiteralPath $artifact -Encoding UTF8
  $artifactHash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash
  $digest = 'sha256:' + ('a' * 64)
  $manifestPath = Join-Path $temp.FullName 'manifest.json'
  @{
    schemaVersion = 1
    sourceRevision = ('b' * 40)
    testCheckpoint = ('c' * 64)
    images = @{
      web = @{ immutableReference = "uhub.service.ucloud.cn/chenucloud/lifeops-web@$digest"; digest = $digest; sbom = @{ verified = $true; digest = $digest }; provenance = @{ verified = $true; digest = $digest } }
      api = @{ immutableReference = "uhub.service.ucloud.cn/chenucloud/lifeops-api@$digest"; digest = $digest; sbom = @{ verified = $true; digest = $digest }; provenance = @{ verified = $true; digest = $digest } }
    }
    artifacts = @(@{ path = $artifact; artifactSha256 = $artifactHash })
  } | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
  $valid = Invoke-Verify $manifestPath
  Require ($valid.ExitCode -eq 0) "A complete artifact-only manifest must pass. Output: $($valid.Output)"

  'tampered' | Set-Content -LiteralPath $artifact -Encoding UTF8
  $tampered = Invoke-Verify $manifestPath
  Require ($tampered.ExitCode -ne 0) 'Artifact hash drift must fail verification.'
  Require ($tampered.Output -match 'ARTIFACT_HASH_MISMATCH') 'Artifact drift must use the stable machine-readable code.'
} finally {
  $resolved = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected temp path: $resolved" }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

if ($failures.Count -gt 0) { throw ("release-manifest-contract failed:`n- " + ($failures -join "`n- ")) }
Write-Output 'release-manifest-contract: ok'
