param()

$ErrorActionPreference = 'Stop'
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot ("lifeops-smoke-contract-" + [guid]::NewGuid().ToString('N')))
$scriptUnderTest = Join-Path $PSScriptRoot 'smoke-images.ps1'
$failures = [Collections.Generic.List[string]]::new()
function Add-Failure([bool]$Condition, [string]$Message) { if (!$Condition) { $script:failures.Add($Message) } }

try {
  $fakeDocker = Join-Path $temp.FullName 'fake-docker.ps1'
  @'
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
$line = $Arguments -join ' '
Add-Content -LiteralPath $env:LIFEOPS_SMOKE_FAKE_LOG -Value $line -Encoding UTF8
if ($env:LIFEOPS_SMOKE_FAKE_FAIL -and $line -match $env:LIFEOPS_SMOKE_FAKE_FAIL) { 'IMAGE_SMOKE_INJECTED_FAILURE'; exit 41 }
if ($Arguments[0] -eq 'version') { '29.7.2'; exit 0 }
if ($Arguments[0] -eq 'network' -and $Arguments[1] -eq 'create') { 'fake-network-id'; exit 0 }
if ($Arguments[0] -eq 'run' -and $Arguments -contains '--detach') { 'fake-container-id'; exit 0 }
if ($Arguments[0] -eq 'inspect') {
  if ($line -match '\.State\.Health\.Status') { 'healthy'; exit 0 }
  if ($line -match '\.Config\.User') { '10001'; exit 0 }
  if ($line -match '\.HostConfig\.ReadonlyRootfs') { 'true'; exit 0 }
  if ($line -match '\.State\.ExitCode') { '0'; exit 0 }
}
if ($Arguments[0] -eq 'run') { 'probe-ok'; exit 0 }
exit 0
'@ | Set-Content -LiteralPath $fakeDocker -Encoding UTF8

  foreach ($case in @(
    [pscustomobject]@{ Name = 'success'; Fail = '' },
    [pscustomobject]@{ Name = 'probe-failure'; Fail = '-api-probe' }
  )) {
    $log = Join-Path $temp.FullName "$($case.Name).log"
    'preexisting-resource-must-remain' | Set-Content -LiteralPath $log -Encoding UTF8
    $env:LIFEOPS_SMOKE_FAKE_LOG = $log
    $env:LIFEOPS_SMOKE_FAKE_FAIL = $case.Fail
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $output = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptUnderTest `
      -WebImage 'registry.example/lifeops-web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' `
      -ApiImage 'registry.example/lifeops-api@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' `
      -DockerExecutable $fakeDocker -RequireDigest 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previous
    $recorded = Get-Content -LiteralPath $log -Raw

    if ($case.Name -eq 'success') { Add-Failure ($exitCode -eq 0) "Successful smoke fixture must pass. Output: $output" }
    else {
      Add-Failure ($exitCode -ne 0) 'Injected probe failure must propagate a non-zero exit.'
      Add-Failure (($output -replace '\s', '') -match 'IMAGE_SMOKE_INJECTED_FAILURE') 'Failure output must retain only an explicit credential-safe diagnostic marker.'
    }
    Add-Failure ($recorded -match 'network create lifeops-smoke-') 'Smoke must create a uniquely owned disposable network.'
    Add-Failure ($recorded -match 'mysql:8\.4\.10') 'Smoke must create an exact MySQL 8.4.10 dependency.'
    Add-Failure ($recorded -match '--log-bin-trust-function-creators=1') 'Smoke MySQL must permit versioned trigger migrations without global app-user privileges.'
    $mysqlReadyIndex = $recorded.IndexOf('SELECT 1')
    $migrationIndex = $recorded.IndexOf('dist/migrate-main.js')
    Add-Failure ($mysqlReadyIndex -ge 0) 'Smoke must prove application-user MySQL network readiness.'
    Add-Failure ($migrationIndex -ge 0 -and $mysqlReadyIndex -lt $migrationIndex) 'MySQL network readiness must precede migrations.'
    if ($case.Name -eq 'success') {
      Add-Failure ($recorded -match 'IMAGE_SMOKE_WEB_SPA_MARKER_MISSING') 'Web deep-link probe must emit a credential-safe failure marker.'
      Add-Failure ($recorded -match 'String\.fromCharCode\(34\)') 'Web deep-link probe must preserve HTML quote matching across Windows Docker argument forwarding.'
    }
    Add-Failure ($recorded -match 'network rm lifeops-smoke-') 'Smoke must always remove the network it created.'
    Add-Failure ($recorded -match 'rm .*lifeops-smoke-') 'Smoke must always remove only its generated containers.'
    Add-Failure ($recorded -notmatch '(?:rm|stop).*preexisting-resource-must-remain') 'Smoke must never remove or stop a pre-existing resource.'
    Add-Failure ($output -notmatch 'smoke-admin-password|smoke-mysql-password|smoke-root-password') 'Smoke output must redact generated credentials.'
  }
} finally {
  Remove-Item Env:LIFEOPS_SMOKE_FAKE_LOG -ErrorAction SilentlyContinue
  Remove-Item Env:LIFEOPS_SMOKE_FAKE_FAIL -ErrorAction SilentlyContinue
  $resolvedTemp = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected temp path: $resolvedTemp" }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}

if ($failures.Count -gt 0) { throw ("image-smoke-contract failed:`n- " + ($failures -join "`n- ")) }
Write-Output 'image-smoke-contract: ok'
