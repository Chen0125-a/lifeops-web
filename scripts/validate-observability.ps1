param([switch]$FromStdin)

$ErrorActionPreference = 'Stop'
if (!$FromStdin) { throw 'validate-observability.ps1 requires -FromStdin.' }
$rendered = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($rendered)) { throw 'Observability render is empty.' }

$failures = [Collections.Generic.List[string]]::new()
function Require-Match([string]$Pattern, [string]$Message) {
  if ($rendered -notmatch $Pattern) { $failures.Add($Message) }
}

Require-Match '(?m)^kind:\s*ServiceMonitor\s*$' 'ServiceMonitor is missing.'
Require-Match '(?ms)^kind:\s*ServiceMonitor.*port:\s*metrics\s+path:\s*/metrics\s+interval:\s*30s' 'ServiceMonitor must scrape /metrics every 30 seconds through the metrics port.'
Require-Match '(?ms)^kind:\s*Service.*app\.kubernetes\.io/component:\s*api.*name:\s*metrics\s+port:\s*9090\s+targetPort:\s*http' 'API metrics Service port is missing.'
Require-Match '(?m)^kind:\s*PrometheusRule\s*$' 'PrometheusRule is missing.'
foreach ($alert in @('LifeOpsUnavailable', 'LifeOpsHigh5xxRate', 'LifeOpsHighP95Latency', 'LifeOpsPodRestarting', 'LifeOpsReadinessFailing')) {
  Require-Match "(?m)^\s*-\s*alert:\s*$alert\s*$" "Alert $alert is missing."
}
foreach ($metric in @('up', 'lifeops_http_requests_total', 'lifeops_http_request_duration_seconds_bucket', 'lifeops_http_active_requests', 'container_cpu_usage_seconds_total', 'container_memory_working_set_bytes', 'kube_pod_container_status_restarts_total', 'kube_deployment_status_observed_generation')) {
  Require-Match ([regex]::Escape($metric)) "Dashboard or alert metric $metric is missing."
}
Require-Match '(?m)^\s*runbook_url:\s*docs/runbooks/observability\.md\s*$' 'Alert runbook link is missing.'
if ($rendered -match '(?ms)^kind:\s*HTTPRoute.*value:\s*/metrics') { $failures.Add('HTTPRoute must not expose /metrics.') }

if ($failures.Count -gt 0) { throw ("observability-validation failed:`n- " + ($failures -join "`n- ")) }
Write-Output 'observability-validation: ok'
