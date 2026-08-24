param(
  [Parameter(Mandatory = $true)][string]$WebImage,
  [Parameter(Mandatory = $true)][string]$ApiImage,
  [string]$DockerExecutable = 'docker',
  [switch]$RequireDigest
)

$ErrorActionPreference = 'Stop'
if ($RequireDigest) {
  foreach ($image in @($WebImage, $ApiImage)) {
    if ($image -notmatch '@sha256:[a-f0-9]{64}$') { throw 'Formal image smoke requires exact @sha256: digest references.' }
  }
}

$suffix = [guid]::NewGuid().ToString('N').Substring(0, 12)
$prefix = "lifeops-smoke-$suffix"
$network = $prefix
$mysql = "$prefix-mysql"
$migration = "$prefix-migration"
$api = "$prefix-api"
$web = "$prefix-web"
$apiProbe = "$prefix-api-probe"
$webProbe = "$prefix-web-probe"
$createdContainers = [Collections.Generic.List[string]]::new()
$networkCreated = $false
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot $prefix)

function Invoke-Docker([string]$Operation, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & $DockerExecutable @Arguments 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($code -ne 0) {
    $safeMarker = [regex]::Match($output, '\bIMAGE_SMOKE_[A-Z0-9_.:=-]{1,160}\b').Value
    $diagnostic = if ($safeMarker) { " Diagnostic: $safeMarker." } else { '' }
    throw "Docker operation '$Operation' failed with exit code $code.$diagnostic"
  }
  return $output.Trim()
}

function Test-Docker([string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $null = & $DockerExecutable @Arguments 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  return $code -eq 0
}

function Wait-Healthy([string]$Container) {
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    $status = Invoke-Docker "inspect health for $Container" @('inspect', '--format', '{{.State.Health.Status}}', $Container)
    if ($status -eq 'healthy') { return }
    if ($status -eq 'unhealthy') { throw "Container $Container became unhealthy." }
    Start-Sleep -Seconds 1
  }
  throw "Container $Container did not become healthy within 45 seconds."
}

function Wait-MySqlNetwork([string]$Network, [string]$EnvFile, [string]$Image, [string]$HostName) {
  $probe = (@'
import mysql from 'mysql2/promise';
const connection = await mysql.createConnection({
  host: 'lifeops-smoke-mysql',
  port: Number(process.env.MYSQL_PORT),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});
try { await connection.query('SELECT 1'); } finally { await connection.end(); }
'@).Replace('lifeops-smoke-mysql', $HostName)
  for ($attempt = 0; $attempt -lt 45; $attempt++) {
    if (Test-Docker @(
      'run', '--rm', '--network', $Network, '--env-file', $EnvFile,
      '--entrypoint', 'node', $Image, '--input-type=module', '-e', $probe
    )) { return }
    Start-Sleep -Seconds 1
  }
  throw 'MySQL did not accept an application-user network connection within 45 seconds.'
}

function Write-PrivateEnv([string]$Path, [string[]]$Lines) {
  [IO.File]::WriteAllLines($Path, $Lines, [Text.UTF8Encoding]::new($false))
}

try {
  $null = Invoke-Docker 'version' @('version', '--format', '{{.Server.Version}}')
  foreach ($image in @($WebImage, $ApiImage, 'mysql:8.4.10')) {
    if (!(Test-Docker @('image', 'inspect', $image))) { $null = Invoke-Docker "pull $image" @('pull', $image) }
  }

  $adminAccount = 'smoke@example.invalid'
  $adminPassword = "A-$([guid]::NewGuid().ToString('N'))!"
  $mysqlRootPassword = "R-$([guid]::NewGuid().ToString('N'))!"
  $mysqlPassword = "M-$([guid]::NewGuid().ToString('N'))!"
  $mysqlEnv = Join-Path $temp.FullName 'mysql.env'
  $apiEnv = Join-Path $temp.FullName 'api.env'
  $probeEnv = Join-Path $temp.FullName 'probe.env'
  Write-PrivateEnv $mysqlEnv @(
    "MYSQL_ROOT_PASSWORD=$mysqlRootPassword", 'MYSQL_DATABASE=lifeops', 'MYSQL_USER=lifeops', "MYSQL_PASSWORD=$mysqlPassword"
  )
  Write-PrivateEnv $apiEnv @(
    'LIFEOPS_STORE=mysql', "MYSQL_HOST=$mysql", 'MYSQL_PORT=3306', 'MYSQL_DATABASE=lifeops', 'MYSQL_USER=lifeops',
    "MYSQL_PASSWORD=$mysqlPassword", "LIFEOPS_ADMIN_ACCOUNT=$adminAccount", "LIFEOPS_ADMIN_PASSWORD=$adminPassword",
    'LIFEOPS_ADMIN_DISPLAY_NAME=Smoke Owner', 'LIFEOPS_SECURE_COOKIES=false', 'LIFEOPS_LOGGER=false',
    'LIFEOPS_MEDIA_BACKEND=filesystem', 'LIFEOPS_MEDIA_ROOT=/tmp/lifeops-media'
  )
  Write-PrivateEnv $probeEnv @("PROBE_ACCOUNT=$adminAccount", "PROBE_PASSWORD=$adminPassword")

  $null = Invoke-Docker 'create network' @('network', 'create', $network)
  $networkCreated = $true

  $createdContainers.Add($mysql)
  $null = Invoke-Docker 'start MySQL 8.4.10' @(
    'run', '--detach', '--name', $mysql, '--network', $network, '--env-file', $mysqlEnv,
    '--health-cmd', 'mysqladmin ping -h 127.0.0.1 -uroot -p"$MYSQL_ROOT_PASSWORD" --silent',
    '--health-interval', '2s', '--health-timeout', '3s', '--health-retries', '30',
    'mysql:8.4.10', '--log-bin-trust-function-creators=1'
  )
  Wait-Healthy $mysql
  Wait-MySqlNetwork $network $apiEnv $ApiImage $mysql

  $createdContainers.Add($migration)
  $null = Invoke-Docker 'run migrations' @('run', '--name', $migration, '--network', $network, '--env-file', $apiEnv, $ApiImage, 'node', 'dist/migrate-main.js')

  $createdContainers.Add($api)
  $null = Invoke-Docker 'start API' @(
    'run', '--detach', '--name', $api, '--network', $network, '--env-file', $apiEnv,
    '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', $ApiImage
  )
  $createdContainers.Add($web)
  $null = Invoke-Docker 'start Web' @(
    'run', '--detach', '--name', $web, '--network', $network,
    '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', $WebImage
  )
  Wait-Healthy $api
  Wait-Healthy $web

  foreach ($container in @($api, $web)) {
    $user = Invoke-Docker "inspect user for $container" @('inspect', '--format', '{{.Config.User}}', $container)
    if (!$user -or $user -match '^(?:0|root)$') { throw "Container $container is configured as root." }
    $readOnly = Invoke-Docker "inspect read-only root for $container" @('inspect', '--format', '{{.HostConfig.ReadonlyRootfs}}', $container)
    if ($readOnly -ne 'true') { throw "Container $container does not use a read-only root filesystem." }
  }

  $apiScript = (@'
const base = 'http://lifeops-smoke-api:8080';
const ensure = (condition, message) => { if (!condition) throw new Error(message) };
const health = await fetch(`${base}/healthz`);
ensure(health.status === 200, `IMAGE_SMOKE_API_HEALTH_STATUS_${health.status}`);
const ready = await fetch(`${base}/readyz`);
ensure(ready.status === 200, `IMAGE_SMOKE_API_READY_STATUS_${ready.status}`);
const login = await fetch(`${base}/api/v1/auth/login`, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({account:process.env.PROBE_ACCOUNT,password:process.env.PROBE_PASSWORD})});
ensure(login.status === 200, `IMAGE_SMOKE_LOGIN_STATUS_${login.status}`);
const session = await login.json();
const cookie = login.headers.get('set-cookie').split(';')[0];
const headers = {'content-type':'application/json',cookie,'x-csrf-token':session.csrfToken};
const created = await fetch(`${base}/api/v1/goals`, {method:'POST', headers:{...headers,'idempotency-key':'smoke-goal-create'}, body:JSON.stringify({title:'Image smoke goal'})});
ensure(created.status === 201, `IMAGE_SMOKE_GOAL_CREATE_STATUS_${created.status}`);
const goal = await created.json();
const read = await fetch(`${base}/api/v1/goals/${goal.id}`, {headers:{cookie}});
ensure(read.status === 200, `IMAGE_SMOKE_GOAL_READ_STATUS_${read.status}`);
const updated = await fetch(`${base}/api/v1/goals/${goal.id}`, {method:'PATCH', headers, body:JSON.stringify({title:'Updated image smoke goal',version:goal.version})});
ensure(updated.status === 200, `IMAGE_SMOKE_GOAL_UPDATE_STATUS_${updated.status}`);
const changed = await updated.json();
const deleted = await fetch(`${base}/api/v1/goals/${goal.id}`, {method:'DELETE', headers, body:JSON.stringify({version:changed.version})});
ensure(deleted.status === 204, `IMAGE_SMOKE_GOAL_DELETE_STATUS_${deleted.status}`);
'@).Replace('lifeops-smoke-api', $api)
  $createdContainers.Add($apiProbe)
  $null = Invoke-Docker 'lifeops-smoke-api-probe' @(
    'run', '--name', $apiProbe, '--network', $network, '--env-file', $probeEnv,
    '--entrypoint', 'node', $ApiImage, '--input-type=module', '-e', $apiScript
  )

  $webScript = (@'
const base = 'http://lifeops-smoke-web:8080';
const health = await fetch(`${base}/healthz`);
if (health.status !== 200) throw new Error(`IMAGE_SMOKE_WEB_HEALTH_STATUS_${health.status}`);
const deep = await fetch(`${base}/app/goals`);
const body = await deep.text();
if (deep.status !== 200) throw new Error(`IMAGE_SMOKE_WEB_DEEP_LINK_STATUS_${deep.status}`);
const quote = String.fromCharCode(34);
if (!body.includes(`<div id=${quote}root${quote}></div>`)) throw new Error('IMAGE_SMOKE_WEB_SPA_MARKER_MISSING');
'@).Replace('lifeops-smoke-web', $web)
  $createdContainers.Add($webProbe)
  $null = Invoke-Docker 'lifeops-smoke-web-probe' @(
    'run', '--name', $webProbe, '--network', $network,
    '--entrypoint', 'node', $ApiImage, '--input-type=module', '-e', $webScript
  )

  foreach ($container in @($api, $web)) {
    $null = Invoke-Docker "stop $container" @('stop', '--time', '10', $container)
    $exitCode = Invoke-Docker "inspect exit code for $container" @('inspect', '--format', '{{.State.ExitCode}}', $container)
    if ($exitCode -ne '0') { throw "Container $container did not exit cleanly after SIGTERM." }
  }
  Write-Output 'image-smoke: ok'
} finally {
  for ($index = $createdContainers.Count - 1; $index -ge 0; $index--) {
    $null = & $DockerExecutable rm --force $createdContainers[$index] 2>&1
  }
  if ($networkCreated) { $null = & $DockerExecutable network rm $network 2>&1 }
  $resolvedTemp = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected temp path: $resolvedTemp" }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
