param(
  [Parameter(Mandatory = $true)][string]$WebImage,
  [Parameter(Mandatory = $true)][string]$ApiImage,
  [Parameter(Mandatory = $true)][string]$SourceRevision,
  [string]$DockerExecutable = 'docker',
  [string]$GitExecutable = 'git',
  [string]$PlaywrightImage = 'mcr.microsoft.com/playwright:v1.62.1-noble',
  [string]$EvidencePath = '',
  [ValidateSet('All', 'Remote')][string]$BrowserScope = 'All',
  [switch]$RequireDigest
)

$ErrorActionPreference = 'Stop'
if ($RequireDigest) {
  foreach ($image in @($WebImage, $ApiImage)) {
    if ($image -notmatch '@sha256:[a-f0-9]{64}$') { throw 'Exact-image browser acceptance requires exact @sha256: digest references.' }
  }
}
if ($SourceRevision -notmatch '^[a-f0-9]{40}$') { throw 'Exact-image browser acceptance requires a full 40-character source revision.' }
if ($BrowserScope -eq 'Remote' -and $EvidencePath) { throw 'Remote scope cannot write final exact-image browser evidence.' }

$suffix = [guid]::NewGuid().ToString('N').Substring(0, 12)
$prefix = "lifeops-image-browser-$suffix"
$network = $prefix
$mysql = "$prefix-mysql"
$migration = "$prefix-migration"
$api = "$prefix-api"
$web = "$prefix-web"
$proxy = "$prefix-proxy"
$browser = "$prefix-playwright"
$workspaceVolume = "$prefix-workspace"
$createdContainers = [Collections.Generic.List[string]]::new()
$createdVolumes = [Collections.Generic.List[string]]::new()
$networkCreated = $false
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot $prefix)
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$startedAt = [DateTimeOffset]::UtcNow.ToString('o')

function Invoke-Docker([string]$Operation, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & $DockerExecutable @Arguments 2>&1 | Out-String
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($code -ne 0) {
    $safeMarker = [regex]::Match($output, '\bIMAGE_BROWSER_[A-Z0-9_.:=-]{1,160}\b').Value
    $diagnostic = if ($safeMarker) { " Diagnostic: $safeMarker." } else { '' }
    throw "Docker operation '$Operation' failed with exit code $code.$diagnostic"
  }
  return $output.Trim()
}

function Invoke-DockerStreaming([string]$Operation, [string[]]$Arguments) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $DockerExecutable @Arguments
  $code = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($code -ne 0) { throw "IMAGE_BROWSER_$($Operation)_EXIT_$code" }
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
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $status = Invoke-Docker "inspect health for $Container" @('inspect', '--format', '{{.State.Health.Status}}', $Container)
    if ($status -eq 'healthy') { return }
    if ($status -eq 'unhealthy') { throw "Container $Container became unhealthy." }
    Start-Sleep -Seconds 1
  }
  throw "Container $Container did not become healthy within 60 seconds."
}

function Wait-MySqlNetwork([string]$Network, [string]$EnvFile, [string]$Image, [string]$HostName) {
  $probe = (@'
import mysql from 'mysql2/promise';
const connection = await mysql.createConnection({
  host: 'lifeops-image-browser-mysql',
  port: Number(process.env.MYSQL_PORT),
  database: process.env.MYSQL_DATABASE,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
});
try { await connection.query('SELECT 1'); } finally { await connection.end(); }
'@).Replace('lifeops-image-browser-mysql', $HostName)
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-Docker @(
      'run', '--rm', '--network', $Network, '--env-file', $EnvFile,
      '--entrypoint', 'node', $Image, '--input-type=module', '-e', $probe
    )) { return }
    Start-Sleep -Seconds 1
  }
  throw 'MySQL did not accept an application-user network connection within 60 seconds.'
}

function Wait-Proxy([string]$Network, [string]$Image, [string]$ProxyName) {
  $probe = "const response=await fetch('http://$($ProxyName):8080/healthz');if(response.status!==200)throw new Error('IMAGE_BROWSER_PROXY_STATUS_'+response.status)"
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    if (Test-Docker @(
      'run', '--rm', '--network', $Network, '--entrypoint', 'node', $Image,
      '--input-type=module', '-e', $probe
    )) { return }
    Start-Sleep -Seconds 1
  }
  throw 'Same-origin image browser proxy did not become ready within 60 seconds.'
}

function Write-PrivateEnv([string]$Path, [string[]]$Lines) {
  [IO.File]::WriteAllLines($Path, $Lines, [Text.UTF8Encoding]::new($false))
}

try {
  $null = Invoke-Docker 'version' @('version', '--format', '{{.Server.Version}}')
  foreach ($image in @($WebImage, $ApiImage, 'mysql:8.4.10', 'nginx:1.30.4-alpine3.24', $PlaywrightImage)) {
    if (!(Test-Docker @('image', 'inspect', $image))) { $null = Invoke-Docker "pull $image" @('pull', $image) }
  }

  $sourceArchive = Join-Path $temp.FullName 'source.tar'
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $GitExecutable 'archive' '--format=tar' "--output=$sourceArchive" $SourceRevision
  $gitArchiveExit = $LASTEXITCODE
  $ErrorActionPreference = $previous
  if ($gitArchiveExit -ne 0) { throw "git archive failed with exit code $gitArchiveExit." }

  $adminAccount = 'owner@lifeops.local'
  $adminPassword = 'LifeOps-V1-Remote-Test!'
  $mysqlRootPassword = "R-$([guid]::NewGuid().ToString('N'))!"
  $mysqlPassword = "M-$([guid]::NewGuid().ToString('N'))!"
  $mysqlEnv = Join-Path $temp.FullName 'mysql.env'
  $apiEnv = Join-Path $temp.FullName 'api.env'
  Write-PrivateEnv $mysqlEnv @(
    "MYSQL_ROOT_PASSWORD=$mysqlRootPassword", 'MYSQL_DATABASE=lifeops', 'MYSQL_USER=lifeops', "MYSQL_PASSWORD=$mysqlPassword"
  )
  Write-PrivateEnv $apiEnv @(
    'LIFEOPS_STORE=mysql', "MYSQL_HOST=$mysql", 'MYSQL_PORT=3306', 'MYSQL_DATABASE=lifeops', 'MYSQL_USER=lifeops',
    "MYSQL_PASSWORD=$mysqlPassword", "LIFEOPS_ADMIN_ACCOUNT=$adminAccount", "LIFEOPS_ADMIN_PASSWORD=$adminPassword",
    'LIFEOPS_ADMIN_DISPLAY_NAME=LifeOps Owner', 'LIFEOPS_SECURE_COOKIES=false', 'LIFEOPS_LOGGER=false',
    'LIFEOPS_ALLOWED_ORIGINS=http://127.0.0.1:8081', 'LIFEOPS_PUBLIC_ORIGIN=http://127.0.0.1:8081',
    'LIFEOPS_MEDIA_BACKEND=filesystem', 'LIFEOPS_MEDIA_ROOT=/tmp/lifeops-media'
  )

  $proxyConfig = Join-Path $temp.FullName 'nginx.conf'
  $proxySource = (@'
worker_processes auto;
events { worker_connections 1024; }
http {
  server {
    listen 8080;
    location /api/ {
      proxy_pass http://lifeops-image-browser-api:8080;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
    location / {
      proxy_pass http://lifeops-image-browser-web:8080;
      proxy_set_header Host $host;
    }
  }
}
'@).Replace('lifeops-image-browser-api', $api).Replace('lifeops-image-browser-web', $web)
  [IO.File]::WriteAllText($proxyConfig, $proxySource, [Text.UTF8Encoding]::new($false))

  $null = Invoke-Docker 'create network' @('network', 'create', $network)
  $networkCreated = $true
  $null = Invoke-Docker 'create workspace volume' @('volume', 'create', $workspaceVolume)
  $createdVolumes.Add($workspaceVolume)

  $archiveMount = "$($sourceArchive):/tmp/lifeops-source.tar:ro"
  $imageConfigMount = "$((Join-Path $workspaceRoot 'playwright.image.config.ts')):/tmp/playwright.image.config.ts:ro"
  $remoteImageConfigMount = "$((Join-Path $workspaceRoot 'playwright.remote.image.config.ts')):/tmp/playwright.remote.image.config.ts:ro"
  $portablePlatformTestMount = "$((Join-Path $workspaceRoot 'tests/platform-security.spec.ts')):/tmp/platform-security.spec.ts:ro"
  $portablePublicDetailsTestMount = "$((Join-Path $workspaceRoot 'tests/public-details.spec.ts')):/tmp/public-details.spec.ts:ro"
  $portableProductionAuthTestMount = "$((Join-Path $workspaceRoot 'tests-remote/production-auth.spec.ts')):/tmp/production-auth.spec.ts:ro"
  $loopbackProxyMount = "$((Join-Path $workspaceRoot 'scripts/loopback-image-proxy.mjs')):/tmp/loopback-image-proxy.mjs:ro"
  $null = Invoke-Docker 'seed LF-normalized source workspace' @(
    'run', '--rm', '--volume', "$($workspaceVolume):/work", '--volume', $archiveMount,
    '--volume', $imageConfigMount, '--volume', $remoteImageConfigMount, '--volume', $portablePlatformTestMount,
    '--volume', $portablePublicDetailsTestMount, '--volume', $portableProductionAuthTestMount, '--volume', $loopbackProxyMount,
    $PlaywrightImage, 'bash', '-lc',
    "tar -xf /tmp/lifeops-source.tar -C /work && cp /tmp/playwright.image.config.ts /work/ && cp /tmp/playwright.remote.image.config.ts /work/ && cp /tmp/platform-security.spec.ts /work/tests/ && cp /tmp/public-details.spec.ts /work/tests/ && cp /tmp/production-auth.spec.ts /work/tests-remote/ && cp /tmp/loopback-image-proxy.mjs /work/scripts/ && sed -i 's/\r$//' /work/src/styles/index.css /work/src/styles/private.css"
  )

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

  $createdContainers.Add($proxy)
  $proxyMount = "$($proxyConfig):/etc/nginx/nginx.conf:ro"
  $null = Invoke-Docker 'start same-origin browser proxy' @(
    'run', '--detach', '--name', $proxy, '--network', $network,
    '--volume', $proxyMount, 'nginx:1.30.4-alpine3.24'
  )
  Wait-Proxy $network $ApiImage $proxy

  $browserPrelude = @'
set -e
npm ci --no-audit --no-fund
node scripts/loopback-image-proxy.mjs &
loopback_pid=$!
trap 'kill "$loopback_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 60); do
  if curl --fail --silent --output /dev/null http://127.0.0.1:8081/healthz; then break; fi
  sleep 1
done
curl --fail --silent --output /dev/null http://127.0.0.1:8081/healthz
'@
  $browserCommand = if ($BrowserScope -eq 'All') { $browserPrelude + @'

npm ci --prefix server --no-audit --no-fund
npx playwright test --config playwright.image.config.ts --project=webkit-theme-performance
npx playwright test --config playwright.image.config.ts --project=firefox-theme-performance
npx playwright test --config playwright.image.config.ts --project=chromium --project=chromium-1024-acceptance --project=chromium-768-acceptance --project=chromium-390-acceptance --project=firefox-critical --project=webkit-critical
npx playwright test --config playwright.remote.image.config.ts
'@
  } else { $browserPrelude + @'

npx playwright test --config playwright.remote.image.config.ts
'@
  }
  $createdContainers.Add($browser)
  Invoke-DockerStreaming 'PLAYWRIGHT' @(
    'run', '--name', $browser, '--network', $network, '--ipc=host',
    '--volume', "$($workspaceVolume):/work", '--workdir', '/work',
    '--env', "LIFEOPS_IMAGE_BROWSER_UPSTREAM=http://$($proxy):8080",
    '--env', 'LIFEOPS_IMAGE_BROWSER_BASE_URL=http://127.0.0.1:8081',
    '--env', 'LIFEOPS_IMAGE_BROWSER_REMOTE_BASE_URL=http://127.0.0.1:8081',
    '--env', 'CI=true', '--env', 'TZ=Asia/Shanghai',
    $PlaywrightImage, 'bash', '-lc', $browserCommand
  )

  if ($EvidencePath) {
    $resolvedEvidence = [IO.Path]::GetFullPath((Join-Path (Get-Location) $EvidencePath))
    $evidenceDirectory = Split-Path -Parent $resolvedEvidence
    $null = New-Item -ItemType Directory -Force -Path $evidenceDirectory
    [ordered]@{
      schemaVersion = 1
      sourceRevision = $SourceRevision
      webImage = $WebImage
      apiImage = $ApiImage
      browserEnvironment = $PlaywrightImage
      browserOrigin = 'http://127.0.0.1:8081'
      loopbackTrustBoundary = 'browser-container loopback forwards only to the same-run exact-image proxy'
      secureContextPrecondition = 'window.isSecureContext=true and crypto.randomUUID=function'
      mainBrowserCommand = 'official Linux theme gates plus applicable public, visual and accessibility projects across the six-project matrix'
      remoteBrowserCommand = 'official Linux Chromium/Firefox/WebKit real-API matrix 12'
      workers = 1
      retries = 0
      startedAt = $startedAt
      completedAt = [DateTimeOffset]::UtcNow.ToString('o')
      exitCode = 0
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $resolvedEvidence -Encoding UTF8
  }
  Write-Output 'exact-image-browser-smoke: ok'
} finally {
  for ($index = $createdContainers.Count - 1; $index -ge 0; $index--) {
    $null = & $DockerExecutable rm --force $createdContainers[$index] 2>&1
  }
  for ($index = $createdVolumes.Count - 1; $index -ge 0; $index--) {
    $null = & $DockerExecutable volume rm $createdVolumes[$index] 2>&1
  }
  if ($networkCreated) { $null = & $DockerExecutable network rm $network 2>&1 }
  $resolvedTemp = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw "Unexpected temp path: $resolvedTemp" }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
