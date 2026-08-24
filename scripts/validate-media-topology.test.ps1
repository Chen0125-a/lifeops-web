param([string]$HelmExecutable = '')

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$chart = Join-Path $workspace 'deploy/helm/lifeops-web'
$validator = Join-Path $PSScriptRoot 'validate-media-topology.ps1'

function Resolve-HelmExecutable {
  if ($HelmExecutable) { return $HelmExecutable }
  $command = Get-Command helm -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $packages = Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages'
  $candidate = Get-ChildItem -LiteralPath $packages -Recurse -Filter 'helm.exe' -File -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (!$candidate) { throw 'Helm executable is required for the media topology contract test.' }
  return $candidate
}

function Assert-Match([string]$Text, [string]$Pattern, [string]$Message) {
  if ($Text -notmatch $Pattern) { throw $Message }
}

function Assert-NotMatch([string]$Text, [string]$Pattern, [string]$Message) {
  if ($Text -match $Pattern) { throw $Message }
}

function Render([string]$ValuesFile) {
  $output = & $script:helm template lifeops $chart --values $ValuesFile 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "Helm render failed:`n$output" }
  return $output
}

$script:helm = Resolve-HelmExecutable
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot ("lifeops-media-topology-" + [guid]::NewGuid().ToString('N')))
try {
  $filesystemValues = Join-Path $temp.FullName 'filesystem-rwx.yaml'
  @'
api:
  autoscaling:
    enabled: false
  replicaCount: 2
  image:
    digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
media:
  backend: filesystem
  filesystem:
    root: /var/lib/lifeops/media
    persistence:
      enabled: true
      accessModes: [ReadWriteMany]
'@ | Set-Content -LiteralPath $filesystemValues -Encoding UTF8

  $filesystem = Render $filesystemValues
  Assert-Match $filesystem '(?ms)^kind: Job\s+metadata:.*argocd\.argoproj\.io/hook: PreSync' 'Filesystem render must include the Argo PreSync migration Job.'
  Assert-Match $filesystem '(?ms)^kind: Job.*activeDeadlineSeconds: 600.*backoffLimit: 1.*automountServiceAccountToken: false' 'Migration Job must be finite and must not mount a ServiceAccount token.'
  Assert-Match $filesystem '(?ms)^kind: PersistentVolumeClaim.*accessModes:\s*- ReadWriteMany' 'Filesystem mode must render an RWX media PVC.'
  Assert-Match $filesystem '(?ms)^kind: Deployment.*name: media.*mountPath: "?/var/lib/lifeops/media"?' 'Filesystem mode must mount the media volume in the API Deployment.'
  $images = [regex]::Matches($filesystem, 'image: "(?<image>[^\"]+lifeops-api@sha256:[a-f0-9]{64})"')
  if ($images.Count -lt 2 -or $images[0].Groups['image'].Value -ne $images[1].Groups['image'].Value) {
    throw 'Migration Job and API Deployment must use the same exact API image digest.'
  }

  $s3Values = Join-Path $temp.FullName 's3.yaml'
  @'
media:
  backend: s3
  s3:
    endpoint: https://objects.example.test
    region: us-east-1
    bucket: lifeops-media
    forcePathStyle: true
    existingSecret: lifeops-media-credentials
    accessKeyIdKey: access-key-id
    secretAccessKeyKey: secret-access-key
'@ | Set-Content -LiteralPath $s3Values -Encoding UTF8

  $s3 = Render $s3Values
  Assert-NotMatch $s3 '(?ms)^kind: PersistentVolumeClaim.*lifeops.*media' 'S3 mode must not render a media PVC.'
  Assert-NotMatch $s3 'mountPath: /var/lib/lifeops/media' 'S3 mode must not mount filesystem media storage.'
  Assert-Match $s3 'name: LIFEOPS_MEDIA_BACKEND\s+value: "s3"' 'S3 mode must configure the API backend explicitly.'
  Assert-Match $s3 '(?ms)name: AWS_ACCESS_KEY_ID\s+valueFrom:\s+secretKeyRef:\s+name: "lifeops-media-credentials"\s+key: "access-key-id"' 'S3 access key must come from a Secret key reference.'
  Assert-Match $s3 '(?ms)name: AWS_SECRET_ACCESS_KEY\s+valueFrom:\s+secretKeyRef:\s+name: "lifeops-media-credentials"\s+key: "secret-access-key"' 'S3 secret key must come from a Secret key reference.'
  Assert-NotMatch $s3 'private-s3-secret-value' 'Rendered YAML must never contain an S3 secret value.'

  $invalidValues = Join-Path $temp.FullName 'filesystem-rwo-multi.yaml'
  @'
api:
  autoscaling:
    enabled: false
  replicaCount: 2
media:
  backend: filesystem
  filesystem:
    persistence:
      enabled: true
      accessModes: [ReadWriteOnce]
'@ | Set-Content -LiteralPath $invalidValues -Encoding UTF8

  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $invalidOutput = & $script:helm template lifeops $chart --values $invalidValues 2>&1 | Out-String
  $invalidExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($invalidExitCode -eq 0) { throw 'Helm render must reject multi-replica filesystem storage without ReadWriteMany.' }
  Assert-Match $invalidOutput 'ReadWriteMany' 'Invalid topology error must explain the RWX requirement.'

  $ErrorActionPreference = 'Continue'
  $validatorOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $validator -ValuesFile $invalidValues -HelmExecutable $script:helm 2>&1 | Out-String
  $validatorExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($validatorExitCode -eq 0) { throw 'The standalone topology validator must reject multi-replica RWO media storage.' }
  Assert-Match $validatorOutput 'ReadWriteMany' 'The topology validator must preserve the actionable RWX error.'

  Write-Output 'media-topology-contract: ok'
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected temporary path: $resolvedTemp"
  }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
