param(
  [string]$WorkspaceRoot = '',
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
if (!$WorkspaceRoot) { $WorkspaceRoot = Split-Path -Parent $PSScriptRoot }
$WorkspaceRoot = [IO.Path]::GetFullPath($WorkspaceRoot)

$actions = @(
  [pscustomobject]@{ Name = 'actions/checkout'; Repository = 'https://github.com/actions/checkout.git'; Tag = 'v7.0.1' },
  [pscustomobject]@{ Name = 'actions/setup-node'; Repository = 'https://github.com/actions/setup-node.git'; Tag = 'v7.0.0' },
  [pscustomobject]@{ Name = 'azure/setup-helm'; Repository = 'https://github.com/Azure/setup-helm.git'; Tag = 'v5.0.1' },
  [pscustomobject]@{ Name = 'docker/setup-buildx-action'; Repository = 'https://github.com/docker/setup-buildx-action.git'; Tag = 'v4.3.0' }
)

$resolved = foreach ($action in $actions) {
  $ref = "refs/tags/$($action.Tag)"
  $lines = @(& git ls-remote --tags --refs $action.Repository $ref 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "git ls-remote failed for $($action.Name) $ref`: $($lines -join ' ')" }
  $matches = @($lines | ForEach-Object {
    if ($_ -match "^([a-f0-9]{40})\s+$([regex]::Escape($ref))$") { $Matches[1] }
  } | Where-Object { $_ })
  if ($matches.Count -ne 1) { throw "Expected exactly one 40-character commit for $($action.Name) $ref; found $($matches.Count)." }
  [pscustomobject]@{ Name = $action.Name; Tag = $action.Tag; Sha = $matches[0]; Repository = $action.Repository }
}

if ($Apply) {
  foreach ($relative in @('.github/workflows/ci.yml', '.github/workflows/release.yml')) {
    $path = Join-Path $WorkspaceRoot $relative
    $source = [IO.File]::ReadAllText($path)
    $updated = $source
    foreach ($action in $resolved) {
      $pattern = "(?m)^(\s*-\s*uses:\s*$([regex]::Escape($action.Name))@)[^\s#]+(?:\s+#.*)?$"
      $replacement = "`${1}$($action.Sha) # $($action.Tag)"
      $updated = [regex]::Replace($updated, $pattern, $replacement)
    }
    if ($updated -ne $source) { [IO.File]::WriteAllText($path, $updated, [Text.UTF8Encoding]::new($false)) }
  }
}

$resolved | ConvertTo-Json -Depth 3
