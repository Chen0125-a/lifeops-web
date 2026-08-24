param(
  [string]$MySqlImage = 'mysql:8.4.10',
  [string]$SummaryPath = ''
)

$ErrorActionPreference = 'Stop'

if ($MySqlImage -notmatch '^(?:mysql:8\.4\.10|mysql@sha256:[a-f0-9]{64})$') {
  throw 'IMMUTABLE_MYSQL_IMAGE_REQUIRED'
}

$repositoryRoot = Split-Path -Parent $PSScriptRoot
if (!$SummaryPath) {
  $SummaryPath = Join-Path $repositoryRoot 'outputs/final/data-rehearsal-summary.md'
}
$resolvedSummary = [IO.Path]::GetFullPath($SummaryPath)
$summaryRoot = [IO.Path]::GetFullPath((Join-Path $repositoryRoot 'outputs/final'))
if (!$resolvedSummary.StartsWith($summaryRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'DATA_REHEARSAL_SUMMARY_PATH_OUTSIDE_OUTPUTS_FINAL'
}

$suffix = [guid]::NewGuid().ToString('N').Substring(0, 12)
$sourceContainer = "lifeops-rehearsal-source-$suffix"
$targetContainer = "lifeops-rehearsal-target-$suffix"
$createdContainers = [Collections.Generic.List[string]]::new()
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot "lifeops-data-rehearsal-$suffix")
$mysqlEnv = Join-Path $temp.FullName 'mysql.env'
$dumpPath = Join-Path $temp.FullName 'lifeops-rehearsal.sql'
$fingerprintPath = Join-Path $temp.FullName 'fingerprint.sql'
$sentinelPath = Join-Path $temp.FullName 'sentinel.sql'
$migrationCountPath = Join-Path $temp.FullName 'migration-count.sql'
$sentinelCheckPath = Join-Path $temp.FullName 'sentinel-check.sql'
$sentinel = "sentinel-$suffix"
$previousEnvironment = @{}

function Invoke-Native([string]$Operation, [string]$Executable, [string[]]$Arguments) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & $Executable @Arguments 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($exitCode -ne 0) {
    $safeMarker = [regex]::Match($output, '\b(?:MIGRATION|DATA_REHEARSAL)_[A-Z0-9_.:=-]{1,160}\b').Value
    $diagnostic = if ($safeMarker) { " Diagnostic: $safeMarker." } else { '' }
    throw "Operation '$Operation' failed with exit code $exitCode.$diagnostic"
  }
  return $output.Trim()
}

function Invoke-Docker([string]$Operation, [string[]]$Arguments) {
  return Invoke-Native $Operation 'docker' $Arguments
}

function Test-Docker([string[]]$Arguments) {
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $null = & docker @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  return $exitCode -eq 0
}

function Wait-Healthy([string]$Container) {
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $status = Invoke-Docker "inspect health for $Container" @('inspect', '--format', '{{.State.Health.Status}}', $Container)
    if ($status -eq 'healthy') { return }
    if ($status -eq 'unhealthy') { throw "Container $Container became unhealthy." }
    Start-Sleep -Seconds 1
  }
  throw "Container $Container did not become healthy within 60 seconds."
}

function Start-DisposableMySql([string]$Container, [bool]$PublishPort) {
  $arguments = [Collections.Generic.List[string]]::new()
  foreach ($argument in @(
    'run', '--detach', '--name', $Container, '--env-file', $mysqlEnv,
    '--health-cmd', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqladmin ping -h 127.0.0.1 -uroot --silent',
    '--health-interval', '2s', '--health-timeout', '3s', '--health-retries', '30'
  )) { $arguments.Add($argument) }
  if ($PublishPort) {
    $arguments.Add('--publish')
    $arguments.Add('127.0.0.1::3306')
  }
  $arguments.Add($MySqlImage)
  $arguments.Add('--log-bin-trust-function-creators=1')
  $createdContainers.Add($Container)
  $null = Invoke-Docker "start $Container" $arguments.ToArray()
  Wait-Healthy $Container
}

function Set-ProcessEnvironment([string]$Name, [string]$Value) {
  if (!$previousEnvironment.ContainsKey($Name)) {
    $previousEnvironment[$Name] = [Environment]::GetEnvironmentVariable($Name, 'Process')
  }
  [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Restore-ProcessEnvironment() {
  foreach ($entry in $previousEnvironment.GetEnumerator()) {
    [Environment]::SetEnvironmentVariable($entry.Key, $entry.Value, 'Process')
  }
}

function Invoke-SqlFile([string]$Container, [string]$HostPath, [string]$ContainerFileName, [string]$Operation) {
  $containerPath = "/tmp/$ContainerFileName"
  $null = Invoke-Docker "copy $ContainerFileName to $Container" @('cp', $HostPath, "${Container}:$containerPath")
  return Invoke-Docker $Operation @(
    'exec', $Container, 'sh', '-c', "MYSQL_PWD=`"`$MYSQL_ROOT_PASSWORD`" mysql --protocol=socket -uroot --batch --skip-column-names lifeops < $containerPath"
  )
}

function Get-DatabaseFingerprint([string]$Container) {
  $fingerprint = Invoke-SqlFile $Container $fingerprintPath 'lifeops-rehearsal-fingerprint.sql' "calculate checksum for $Container"
  if ($fingerprint -notmatch '^[A-Fa-f0-9]{64}$') { throw 'DATA_REHEARSAL_CHECKSUM_INVALID' }
  return $fingerprint.ToUpperInvariant()
}

try {
  $null = Invoke-Docker 'Docker server version' @('version', '--format', '{{.Server.Version}}')
  if (!(Test-Docker @('image', 'inspect', $MySqlImage))) {
    $null = Invoke-Docker "pull $MySqlImage" @('pull', $MySqlImage)
  }

  $rootPassword = "R-$([guid]::NewGuid().ToString('N'))!"
  $appPassword = "M-$([guid]::NewGuid().ToString('N'))!"
  [IO.File]::WriteAllLines($mysqlEnv, @(
    "MYSQL_ROOT_PASSWORD=$rootPassword",
    'MYSQL_DATABASE=lifeops',
    'MYSQL_USER=lifeops',
    "MYSQL_PASSWORD=$appPassword"
  ), [Text.UTF8Encoding]::new($false))

  $fingerprintSql = @'
SET SESSION group_concat_max_len = 16777216;
SELECT UPPER(SHA2(CONCAT_WS('#',
  COALESCE((SELECT GROUP_CONCAT(CONCAT_WS(':', version, name, checksum) ORDER BY version SEPARATOR '|') FROM schema_migrations), ''),
  COALESCE((SELECT GROUP_CONCAT(CONCAT_WS(':', table_name, column_name, ordinal_position, column_type, is_nullable, COALESCE(column_default, '<NULL>'), extra) ORDER BY table_name, ordinal_position SEPARATOR '|') FROM information_schema.columns WHERE table_schema = 'lifeops'), ''),
  COALESCE((SELECT GROUP_CONCAT(CONCAT_WS(':', trigger_name, event_manipulation, event_object_table, action_timing) ORDER BY trigger_name SEPARATOR '|') FROM information_schema.triggers WHERE trigger_schema = 'lifeops'), ''),
  COALESCE((SELECT value FROM lifeops_rehearsal_sentinel WHERE id = 1), '')
), 256));
'@
  [IO.File]::WriteAllText($fingerprintPath, $fingerprintSql, [Text.UTF8Encoding]::new($false))
  $sentinelSql = @"
CREATE TABLE lifeops_rehearsal_sentinel (id INT PRIMARY KEY, value VARCHAR(64) NOT NULL) ENGINE=InnoDB;
INSERT INTO lifeops_rehearsal_sentinel (id, value) VALUES (1, '$sentinel');
"@
  [IO.File]::WriteAllText($sentinelPath, $sentinelSql, [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($migrationCountPath, 'SELECT COUNT(*) FROM schema_migrations;', [Text.UTF8Encoding]::new($false))
  [IO.File]::WriteAllText($sentinelCheckPath, 'SELECT value FROM lifeops_rehearsal_sentinel WHERE id = 1;', [Text.UTF8Encoding]::new($false))

  Start-DisposableMySql $sourceContainer $true
  $sourcePort = Invoke-Docker 'resolve source MySQL port' @('port', $sourceContainer, '3306/tcp')
  if ($sourcePort -notmatch '127\.0\.0\.1:(\d+)$') { throw 'DATA_REHEARSAL_SOURCE_PORT_INVALID' }
  $sourcePortNumber = $Matches[1]

  $null = Invoke-Native 'build migration runtime' 'npm.cmd' @('run', 'build:server')
  Set-ProcessEnvironment 'LIFEOPS_STORE' 'mysql'
  Set-ProcessEnvironment 'MYSQL_HOST' '127.0.0.1'
  Set-ProcessEnvironment 'MYSQL_PORT' $sourcePortNumber
  Set-ProcessEnvironment 'MYSQL_DATABASE' 'lifeops'
  Set-ProcessEnvironment 'MYSQL_USER' 'lifeops'
  Set-ProcessEnvironment 'MYSQL_PASSWORD' $appPassword
  Set-ProcessEnvironment 'LIFEOPS_ADMIN_ACCOUNT' 'rehearsal@example.invalid'
  Set-ProcessEnvironment 'LIFEOPS_ADMIN_PASSWORD' "A-$([guid]::NewGuid().ToString('N'))!"
  $null = Invoke-Native 'apply forward migrations' 'node' @('server/dist/migrate-main.js')
  Restore-ProcessEnvironment
  $previousEnvironment.Clear()

  $null = Invoke-Docker 'copy sentinel SQL to source' @('cp', $sentinelPath, "${sourceContainer}:/tmp/lifeops-rehearsal-sentinel.sql")
  $null = Invoke-Docker 'insert sentinel row' @(
    'exec', $sourceContainer, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot lifeops < /tmp/lifeops-rehearsal-sentinel.sql'
  )
  $sourceChecksum = Get-DatabaseFingerprint $sourceContainer
  $migrationCount = Invoke-SqlFile $sourceContainer $migrationCountPath 'lifeops-rehearsal-migration-count.sql' 'count applied migrations'
  if ($migrationCount -notmatch '^\d+$' -or [int]$migrationCount -lt 1) { throw 'DATA_REHEARSAL_MIGRATION_COUNT_INVALID' }

  $null = Invoke-Docker 'create mysqldump' @(
    'exec', $sourceContainer, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --protocol=socket -uroot --single-transaction --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF --add-drop-database --databases lifeops > /tmp/lifeops-rehearsal.sql'
  )
  $null = Invoke-Docker 'copy mysqldump to host' @('cp', "${sourceContainer}:/tmp/lifeops-rehearsal.sql", $dumpPath)
  if (!(Test-Path -LiteralPath $dumpPath -PathType Leaf) -or (Get-Item -LiteralPath $dumpPath).Length -lt 1024) {
    throw 'DATA_REHEARSAL_DUMP_INVALID'
  }
  $dumpChecksum = (Get-FileHash -Algorithm SHA256 -LiteralPath $dumpPath).Hash

  Start-DisposableMySql $targetContainer $false
  $null = Invoke-Docker 'copy mysqldump to target' @('cp', $dumpPath, "${targetContainer}:/tmp/lifeops-rehearsal.sql")
  $null = Invoke-Docker 'restore mysqldump' @(
    'exec', $targetContainer, 'sh', '-c', 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql --protocol=socket -uroot < /tmp/lifeops-rehearsal.sql'
  )
  $targetChecksum = Get-DatabaseFingerprint $targetContainer
  if ($sourceChecksum -ne $targetChecksum) { throw 'DATA_REHEARSAL_CHECKSUM_MISMATCH' }
  $restoredSentinel = Invoke-SqlFile $targetContainer $sentinelCheckPath 'lifeops-rehearsal-sentinel-check.sql' 'verify restored sentinel'
  if ($restoredSentinel -ne $sentinel) { throw 'DATA_REHEARSAL_SENTINEL_MISMATCH' }

  $summaryDirectory = Split-Path -Parent $resolvedSummary
  $null = New-Item -ItemType Directory -Path $summaryDirectory -Force
  $summary = @"
# LifeOps pre-release data rehearsal

- Result: PASS
- MySQL image: ``$MySqlImage``
- Applied migrations: $migrationCount
- Dump SHA-256: ``$dumpChecksum``
- Source logical checksum: ``$sourceChecksum``
- Restored logical checksum: ``$targetChecksum``
- Sentinel restored: yes
- Scope: disposable local containers only; no user database or cluster access
"@
  [IO.File]::WriteAllText($resolvedSummary, $summary.TrimStart(), [Text.UTF8Encoding]::new($false))
  Write-Output "data-rehearsal: migrations=$migrationCount checksum=$sourceChecksum"
  Write-Output "summary: $resolvedSummary"
  Write-Output 'DATA_REHEARSAL_OK'
} finally {
  Restore-ProcessEnvironment
  for ($index = $createdContainers.Count - 1; $index -ge 0; $index--) {
    $container = $createdContainers[$index]
    if ($container -notmatch '^lifeops-rehearsal-(?:source|target)-[a-f0-9]{12}$') {
      throw "Unexpected rehearsal container name: $container"
    }
    $null = & docker rm --force $container 2>&1
  }
  $resolvedTemp = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unexpected rehearsal temp path: $resolvedTemp"
  }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
