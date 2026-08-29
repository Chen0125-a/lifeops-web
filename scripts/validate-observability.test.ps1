param([string]$HelmExecutable = '')

$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$chart = Join-Path $workspace 'deploy/helm/lifeops-web'

function Resolve-HelmExecutable {
  if ($HelmExecutable) { return $HelmExecutable }
  $command = Get-Command helm -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  $packages = Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages'
  $candidate = Get-ChildItem -LiteralPath $packages -Recurse -Filter 'helm.exe' -File -ErrorAction SilentlyContinue |
    Select-Object -First 1 -ExpandProperty FullName
  if (!$candidate) { throw 'Helm executable is required for the observability contract test.' }
  return $candidate
}

function Render([string]$ValuesFile) {
  $output = & $script:helm template lifeops $chart --namespace lifeops --values $ValuesFile 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "Helm render failed:`n$output" }
  return $output
}

function Resource([string]$Rendered, [string]$Kind, [string]$NameSuffix = '') {
  foreach ($document in [regex]::Split($Rendered, '(?m)^---\s*$')) {
    if ($document -match "(?m)^kind:\s*$([regex]::Escape($Kind))\s*$" -and
        (!$NameSuffix -or $document -match "(?m)^\s*name:\s*[^\r\n]*$([regex]::Escape($NameSuffix))\s*$")) {
      return $document
    }
  }
  return ''
}

function Add-Failure([bool]$Condition, [string]$Message) {
  if (!$Condition) { $script:failures.Add($Message) }
}

$script:helm = Resolve-HelmExecutable
$script:failures = [Collections.Generic.List[string]]::new()
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot ("lifeops-observability-" + [guid]::NewGuid().ToString('N')))
try {
  $disabledValues = Join-Path $temp.FullName 'disabled.yaml'
  @'
monitoring:
  enabled: false
'@ | Set-Content -LiteralPath $disabledValues -Encoding UTF8
  $disabled = Render $disabledValues
  Add-Failure (-not (Resource $disabled 'ServiceMonitor')) 'Disabled monitoring must not render a ServiceMonitor.'
  Add-Failure (-not (Resource $disabled 'PrometheusRule')) 'Disabled monitoring must not render a PrometheusRule.'
  Add-Failure (-not (Resource $disabled 'ConfigMap' '-grafana-dashboard')) 'Disabled monitoring must not render a Grafana dashboard ConfigMap.'

  $enabledValues = Join-Path $temp.FullName 'enabled.yaml'
  @'
monitoring:
  enabled: true
  serviceMonitor:
    interval: 30s
  grafana:
    sidecarLabel: grafana_dashboard
    sidecarLabelValue: "1"
networkPolicy:
  enabled: true
'@ | Set-Content -LiteralPath $enabledValues -Encoding UTF8
  $enabled = Render $enabledValues
  $serviceMonitor = Resource $enabled 'ServiceMonitor'
  $rules = Resource $enabled 'PrometheusRule'
  $dashboard = Resource $enabled 'ConfigMap' '-grafana-dashboard'
  $apiService = Resource $enabled 'Service' '-api'
  $httpRoute = Resource $enabled 'HTTPRoute'
  $apiPolicy = Resource $enabled 'NetworkPolicy' '-api'

  Add-Failure ($serviceMonitor -match '(?ms)^apiVersion:\s*monitoring\.coreos\.com/v1.*endpoints:\s*-\s*port:\s*metrics\s+path:\s*/metrics\s+interval:\s*30s') 'ServiceMonitor must scrape the named internal metrics port at /metrics every 30 seconds.'
  Add-Failure ($apiService -match '(?ms)ports:.*name:\s*metrics\s+port:\s*9090\s+targetPort:\s*http') 'API Service must expose a cluster-internal named metrics port.'
  Add-Failure ($httpRoute -notmatch '(?m)value:\s*/metrics') 'Gateway/HTTPRoute must not publish /metrics explicitly.'
  Add-Failure ($apiPolicy -match '(?ms)kubernetes\.io/metadata\.name:\s*monitoring.*app\.kubernetes\.io/name:\s*prometheus.*port:\s*8080') 'NetworkPolicy must allow the named Prometheus peer to scrape only the API container port.'

  foreach ($alert in @('LifeOpsUnavailable', 'LifeOpsHigh5xxRate', 'LifeOpsHighP95Latency', 'LifeOpsPodRestarting', 'LifeOpsReadinessFailing')) {
    Add-Failure ($rules -match "(?m)^\s*-\s*alert:\s*$alert\s*$") "PrometheusRule must contain $alert."
  }
  Add-Failure ($rules -match '(?ms)alert:\s*LifeOpsUnavailable.*for:\s*2m.*severity:\s*critical.*runbook_url:\s*docs/runbooks/observability\.md') 'Unavailable alert must have a bounded for duration, severity and runbook.'
  Add-Failure ($rules -match '(?ms)alert:\s*LifeOpsHigh5xxRate.*lifeops_http_requests_total.*status_class.*5xx.*clamp_min.*for:\s*10m.*severity:\s*warning') '5xx alert must use the bounded application request ratio and zero-traffic guard.'
  Add-Failure ($rules -match '(?ms)alert:\s*LifeOpsHighP95Latency.*histogram_quantile.*lifeops_http_request_duration_seconds_bucket.*for:\s*10m') 'Latency alert must use the exported duration histogram p95.'
  Add-Failure ($rules -match '(?ms)alert:\s*LifeOpsPodRestarting.*kube_pod_container_status_restarts_total.*for:\s*10m') 'Restart alert must use Kubernetes restart metrics with a for duration.'
  Add-Failure ($rules -match '(?ms)alert:\s*LifeOpsReadinessFailing.*kube_pod_status_ready.*for:\s*5m') 'Readiness alert must use Kubernetes readiness metrics with a for duration.'

  Add-Failure ($dashboard -match '(?m)^\s*grafana_dashboard:\s*"1"\s*$') 'Grafana dashboard ConfigMap must carry the configured sidecar label.'
  foreach ($metric in @('up', 'lifeops_http_requests_total', 'lifeops_http_request_duration_seconds_bucket', 'lifeops_http_active_requests', 'container_cpu_usage_seconds_total', 'container_memory_working_set_bytes', 'kube_pod_container_status_restarts_total', 'kube_deployment_status_observed_generation')) {
    Add-Failure ($dashboard -match [regex]::Escape($metric)) "Grafana dashboard must reference $metric."
  }

  $validator = Join-Path $PSScriptRoot 'validate-observability.ps1'
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $validatorOutput = $enabled | & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $validator -FromStdin 2>&1 | Out-String
  $validatorExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previous
  Add-Failure ($validatorExitCode -eq 0) "Standalone observability validation must accept the reviewed render. Output: $validatorOutput"

  $directPipelineOutput = ''
  $directPipelineAccepted = $true
  try {
    $directPipelineOutput = $enabled | & $validator -FromStdin 2>&1 | Out-String
  } catch {
    $directPipelineAccepted = $false
    $directPipelineOutput = $_ | Out-String
  }
  Add-Failure $directPipelineAccepted "Direct PowerShell pipeline validation must accept the reviewed render. Output: $directPipelineOutput"

  if ($script:failures.Count -gt 0) {
    throw ("observability-contract failed:`n- " + ($script:failures -join "`n- "))
  }
  Write-Output 'observability-contract: ok'
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected temporary path: $resolvedTemp"
  }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
