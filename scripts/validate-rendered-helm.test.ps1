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
  if (!$candidate) { throw 'Helm executable is required for the rendered manifest contract test.' }
  return $candidate
}

function Render([string]$ValuesFile) {
  $output = & $script:helm template lifeops $chart --namespace lifeops --values $ValuesFile 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "Helm render failed:`n$output" }
  return $output
}

function Render-Result([string]$ValuesFile) {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $output = & $script:helm template lifeops $chart --namespace lifeops --values $ValuesFile 2>&1 | Out-String
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previous
  return @{ Output = $output; ExitCode = $exitCode }
}

function Add-Failure([bool]$Condition, [string]$Message) {
  if (!$Condition) { $script:failures.Add($Message) }
}

function Resource([string]$Rendered, [string]$Kind, [string]$NameSuffix = '') {
  $documents = [regex]::Split($Rendered, '(?m)^---\s*$')
  foreach ($document in $documents) {
    if ($document -match "(?m)^kind:\s*$([regex]::Escape($Kind))\s*$" -and
        (!$NameSuffix -or $document -match "(?m)^\s*name:\s*[^\r\n]*$([regex]::Escape($NameSuffix))\s*$")) {
      return $document
    }
  }
  return ''
}

function Resources([string]$Rendered, [string]$Kind) {
  $results = [Collections.Generic.List[string]]::new()
  foreach ($document in [regex]::Split($Rendered, '(?m)^---\s*$')) {
    if ($document -match "(?m)^kind:\s*$([regex]::Escape($Kind))\s*$") { $results.Add($document) }
  }
  return $results
}

function Assert-PodSecurity([string]$Document, [string]$Label, [bool]$RequiresProbes) {
  Add-Failure ([bool]$Document) "$Label must render."
  if (!$Document) { return }
  Add-Failure ($Document -match '(?m)^\s*automountServiceAccountToken:\s*false\s*$') "$Label must disable implicit ServiceAccount token mounting."
  Add-Failure ($Document -match '(?ms)securityContext:.*runAsNonRoot:\s*true.*runAsUser:\s*[1-9]\d*.*runAsGroup:\s*[1-9]\d*.*seccompProfile:\s*\r?\n\s*type:\s*RuntimeDefault') "$Label must use a non-root numeric UID/GID and RuntimeDefault seccomp."
  Add-Failure ($Document -match '(?ms)containers:.*securityContext:.*allowPrivilegeEscalation:\s*false.*readOnlyRootFilesystem:\s*true.*capabilities:\s*\r?\n\s*drop:\s*\["ALL"\]') "$Label containers must disallow privilege escalation, use a read-only root filesystem and drop ALL capabilities."
  Add-Failure ($Document -notmatch '(?ms)capabilities:.*\r?\n\s*add:') "$Label must not add Linux capabilities."
  $resources = [regex]::Match($Document, '(?ms)^\s*resources:\s*\r?\n(?<body>(?:\s{12,}.*\r?\n?)+)').Groups['body'].Value
  Add-Failure ($resources -match '(?ms)requests:.*cpu:\s*\S+.*memory:\s*\S+') "$Label must define finite CPU and memory requests."
  Add-Failure ($resources -match '(?ms)limits:.*cpu:\s*\S+.*memory:\s*\S+') "$Label must define finite CPU and memory limits."
  Add-Failure ($Document -match '(?m)^\s*terminationGracePeriodSeconds:\s*[1-9]\d*\s*$') "$Label must define a positive graceful termination period."
  if ($RequiresProbes) {
    Add-Failure ($Document -match '(?ms)readinessProbe:.*livenessProbe:') "$Label must define readiness and liveness probes."
  }
}

$script:helm = Resolve-HelmExecutable
$script:failures = [Collections.Generic.List[string]]::new()
$tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$temp = New-Item -ItemType Directory -Path (Join-Path $tempRoot ("lifeops-rendered-helm-" + [guid]::NewGuid().ToString('N')))
try {
  $enabledValues = Join-Path $temp.FullName 'kubernetes-enabled.yaml'
  @'
platform:
  kubernetes:
    enabled: true
    baseUrl: https://kubernetes.default.svc
'@ | Set-Content -LiteralPath $enabledValues -Encoding UTF8

  $enabled = Render $enabledValues
  $serviceAccount = Resource $enabled 'ServiceAccount' '-platform'
  $clusterRole = Resource $enabled 'ClusterRole' '-platform-readonly'
  $binding = Resource $enabled 'ClusterRoleBinding' '-platform-readonly'
  $api = Resource $enabled 'Deployment' '-api'
  $configMap = Resource $enabled 'ConfigMap' '-config'

  Add-Failure ([bool]$serviceAccount) 'Enabled Kubernetes integration must render a dedicated platform ServiceAccount.'
  Add-Failure ([bool]$clusterRole) 'Enabled Kubernetes integration must render the read-only platform ClusterRole.'
  Add-Failure ([bool]$binding) 'Enabled Kubernetes integration must bind only the dedicated platform ServiceAccount.'
  Add-Failure ($api -match '(?ms)serviceAccountName:\s*lifeops-platform.*projected:.*serviceAccountToken:.*expirationSeconds:\s*(?:[6-9]\d\d|[1-3]\d{3})\b') 'Enabled Kubernetes integration must explicitly project a bounded ServiceAccount token into the API pod.'
  Add-Failure ($configMap -match '(?m)^\s*LIFEOPS_KUBERNETES_BEARER_TOKEN_FILE:\s*"/var/run/secrets/lifeops/token"\s*$') 'Non-secret configuration must point the server at the projected Kubernetes token file.'
  Add-Failure ($configMap -match '(?m)^\s*LIFEOPS_KUBERNETES_CA_FILE:\s*"/var/run/secrets/lifeops/ca\.crt"\s*$') 'Non-secret configuration must point the server at the projected Kubernetes CA file.'
  Add-Failure ($api -match '(?ms)envFrom:\s*-\s*configMapRef:\s*name:\s*lifeops-config.*mountPath:\s*/var/run/secrets/lifeops\s+readOnly:\s*true') 'The API must consume the ConfigMap and mount the projected token/CA read-only.'

  if ($clusterRole) {
    Add-Failure ($clusterRole -match '(?ms)apiGroups:\s*-\s*""\s+resources:\s*-\s*nodes\s+verbs:\s*-\s*get\s+-\s*list') 'Core node permissions must be exactly get/list.'
    Add-Failure ($clusterRole -match '(?ms)apiGroups:\s*-\s*""\s+resources:\s*-\s*pods\s+-\s*services\s+-\s*namespaces\s+verbs:\s*-\s*get\s+-\s*list') 'Core pod/service/namespace permissions must be exactly get/list.'
    Add-Failure ($clusterRole -match '(?ms)apiGroups:\s*-\s*apps\s+resources:\s*-\s*deployments\s+-\s*statefulsets\s+-\s*daemonsets\s+-\s*replicasets\s+verbs:\s*-\s*get\s+-\s*list') 'Apps workload permissions must be exactly get/list.'
    Add-Failure ($clusterRole -match '(?ms)apiGroups:\s*-\s*gateway\.networking\.k8s\.io\s+resources:\s*-\s*httproutes\s+-\s*gateways\s+verbs:\s*-\s*get\s+-\s*list') 'Gateway API permissions must be exactly get/list.'
    Add-Failure ($clusterRole -notmatch '(?m)^\s*-\s*"?\*"?\s*$') 'RBAC must not contain wildcard groups, resources or verbs.'
    Add-Failure ($clusterRole -notmatch '(?m)^\s*nonResourceURLs:') 'RBAC must not grant non-resource URL access.'
    Add-Failure ($clusterRole -notmatch '(?i)(?:secrets|pods/log|pods/exec|impersonate|create|update|patch|delete|deletecollection|watch)') 'RBAC must not grant Secret, log, exec, impersonation, watch or mutation access.'
  }

  $disabledValues = Join-Path $temp.FullName 'kubernetes-disabled.yaml'
  @'
platform:
  kubernetes:
    enabled: false
'@ | Set-Content -LiteralPath $disabledValues -Encoding UTF8
  $disabled = Render $disabledValues
  $disabledApi = Resource $disabled 'Deployment' '-api'
  Add-Failure (-not (Resource $disabled 'ServiceAccount' '-platform')) 'Disabled Kubernetes integration must not render the platform ServiceAccount.'
  Add-Failure (-not (Resource $disabled 'ClusterRole' '-platform-readonly')) 'Disabled Kubernetes integration must not render the platform ClusterRole.'
  Add-Failure (-not (Resource $disabled 'ClusterRoleBinding' '-platform-readonly')) 'Disabled Kubernetes integration must not render the platform ClusterRoleBinding.'
  Add-Failure ($disabledApi -notmatch '(?im)^\s*serviceAccountToken:|^\s*serviceAccountName:|/var/run/secrets/lifeops') 'Disabled Kubernetes integration must not project or select a Kubernetes ServiceAccount token.'

  Assert-PodSecurity (Resource $enabled 'Deployment' '-web') 'Web Deployment' $true
  Assert-PodSecurity $api 'API Deployment' $true
  $mysqlWorkload = Resource $enabled 'StatefulSet' '-mysql'
  Assert-PodSecurity $mysqlWorkload 'MySQL StatefulSet' $true
  Add-Failure ($mysqlWorkload -match '(?m)^\s*-\s*--log-bin-trust-function-creators=1\s*$') 'MySQL must permit version-controlled trigger migrations without global app-user privileges.'
  $migration = Resource $enabled 'Job' '-migrate'
  Assert-PodSecurity $migration 'Migration Job' $false
  Add-Failure ($migration -match '(?ms)activeDeadlineSeconds:\s*[1-9]\d*.*backoffLimit:\s*[01]\b') 'Migration Job must have a finite deadline and bounded retry count.'

  $web = Resource $enabled 'Deployment' '-web'
  foreach ($workload in @(@{ Name = 'Web'; Document = $web }, @{ Name = 'API'; Document = $api })) {
    Add-Failure ($workload.Document -match '(?ms)strategy:\s*type:\s*RollingUpdate.*maxUnavailable:\s*0.*maxSurge:\s*1') "$($workload.Name) Deployment must use zero-unavailable rolling updates."
    Add-Failure ($workload.Document -match '(?ms)topologySpreadConstraints:.*topologyKey:\s*kubernetes\.io/hostname.*whenUnsatisfiable:\s*DoNotSchedule') "$($workload.Name) Deployment must spread replicas across nodes."
    Add-Failure ($workload.Document -match '(?ms)affinity:.*podAntiAffinity:.*preferredDuringSchedulingIgnoredDuringExecution:.*topologyKey:\s*kubernetes\.io/hostname') "$($workload.Name) Deployment must prefer pod anti-affinity across nodes."
    Add-Failure ($workload.Document -match '(?m)^\s*checksum/non-secret-config:\s*[a-f0-9]{64}\s*$') "$($workload.Name) Deployment must roll out on non-secret ConfigMap changes."
  }
  Add-Failure ($migration -match '(?m)^\s*checksum/non-secret-config:\s*[a-f0-9]{64}\s*$') 'Migration Job must be bound to the reviewed non-secret ConfigMap checksum.'
  Add-Failure ($enabled -notmatch '(?m)^\s*hostPath:|^\s*privileged:\s*true') 'Rendered workloads must not use hostPath or privileged containers.'
  foreach ($component in @('web', 'api')) {
    $pdb = Resource $enabled 'PodDisruptionBudget' ("-" + $component)
    Add-Failure ($pdb -match "(?ms)component:\s*$component.*minAvailable:\s*[1-9]\d*") "$component must render a finite PodDisruptionBudget."
  }

  $productionValues = Join-Path $workspace 'deploy/gitops/environments/production/values.yaml'
  $productionSource = Get-Content -LiteralPath $productionValues -Raw
  $production = Render $productionValues
  Add-Failure ($productionSource -notmatch '(?m)^\s+(?:adminPassword|mysqlPassword|mysqlRootPassword):\s*\S+') 'Production values must not contain non-empty inline secret values.'
  Add-Failure ($production -notmatch '(?m)^kind:\s*Secret\s*$|(?m)^stringData:') 'Production rendering must consume an existing Secret or ExternalSecret and must not create inline Secret data.'
  Add-Failure ($production -notmatch 'p6-t2-known-fixture-secret') 'Rendered production output must not contain the known secret fixture.'
  foreach ($name in @('MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'LIFEOPS_ADMIN_PASSWORD', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY')) {
    $occurrences = [regex]::Matches($production, "(?ms)name:\s*$name\s+valueFrom:\s+secretKeyRef:")
    $plain = $production -match "(?ms)name:\s*$name\s+value:\s*"
    Add-Failure (!$plain) "$name must never use a plain rendered value."
    if ($production -match "(?m)^\s*-\s*name:\s*$name\s*$") {
      Add-Failure ($occurrences.Count -gt 0) "$name must use secretKeyRef in every rendered workload."
    }
  }

  $inlineValues = Join-Path $temp.FullName 'production-inline-secret.yaml'
  @'
production: true
secrets:
  create: true
  data:
    adminPassword: p6-t2-known-fixture-secret
    mysqlPassword: p6-t2-known-fixture-secret
    mysqlRootPassword: p6-t2-known-fixture-secret
'@ | Set-Content -LiteralPath $inlineValues -Encoding UTF8
  $inlineResult = Render-Result $inlineValues
  Add-Failure ($inlineResult.ExitCode -ne 0) 'Production schema must reject non-empty inline secret data.'
  Add-Failure ($inlineResult.Output -notmatch 'p6-t2-known-fixture-secret') 'A rejected production inline secret must never be emitted in rendered output.'

  $ambiguousRouteValues = Join-Path $temp.FullName 'production-ambiguous-route.yaml'
  @'
production: true
ingress:
  enabled: true
httpRoute:
  enabled: true
'@ | Set-Content -LiteralPath $ambiguousRouteValues -Encoding UTF8
  $ambiguousRouteResult = Render-Result $ambiguousRouteValues
  Add-Failure ($ambiguousRouteResult.ExitCode -ne 0) 'Schema must reject mutually enabled Ingress and HTTPRoute.'

  $integrationSecretValues = Join-Path $temp.FullName 'integration-secret-ref.yaml'
  @'
platform:
  integrations:
    github:
      enabled: true
      baseUrl: https://api.github.com
      deepLinkUrl: https://github.com/example/lifeops
      timeoutMs: 3000
      maxResponseBytes: 262144
      existingSecret: lifeops-github
      bearerTokenKey: bearer-token
'@ | Set-Content -LiteralPath $integrationSecretValues -Encoding UTF8
  $integrationSecret = Render $integrationSecretValues
  $integrationApi = Resource $integrationSecret 'Deployment' '-api'
  Add-Failure ($integrationApi -match '(?ms)name:\s*LIFEOPS_GITHUB_BEARER_TOKEN\s+valueFrom:\s+secretKeyRef:\s+name:\s*"lifeops-github"\s+key:\s*"bearer-token"') 'Enabled integration credentials must be consumed only through an existing Secret key reference.'
  Add-Failure ($integrationSecret -notmatch '(?ms)name:\s*LIFEOPS_GITHUB_BEARER_TOKEN\s+value:\s*') 'Integration credentials must never render as plain values.'

  $networkValues = Join-Path $temp.FullName 'network-policy.yaml'
  @'
platform:
  kubernetes:
    enabled: true
    baseUrl: https://kubernetes.default.svc
networkPolicy:
  enabled: true
  gateway:
    namespace: envoy-gateway-system
  prometheus:
    namespace: monitoring
    podLabels:
      app.kubernetes.io/name: prometheus
  dns:
    namespace: kube-system
    podLabels:
      k8s-app: kube-dns
  integrationEgress:
    - name: kubernetes-api
      cidr: 10.96.0.1/32
      port: 443
    - name: prometheus
      cidr: 10.20.0.5/32
      port: 9090
'@ | Set-Content -LiteralPath $networkValues -Encoding UTF8
  $network = Render $networkValues
  $networkPolicies = Resources $network 'NetworkPolicy'
  Add-Failure ($networkPolicies.Count -ge 4) 'Network isolation must render default, Web, API and MySQL policies.'
  $defaultDeny = Resource $network 'NetworkPolicy' '-default-deny'
  Add-Failure ($defaultDeny -match '(?ms)podSelector:\s*matchLabels:\s*app\.kubernetes\.io/name:\s*lifeops\s+app\.kubernetes\.io/instance:\s*lifeops.*policyTypes:\s*-\s*Ingress\s+-\s*Egress') 'Default isolation must deny both ingress and egress for LifeOps release pods without selecting unrelated namespace workloads.'
  $webPolicy = Resource $network 'NetworkPolicy' '-web'
  Add-Failure ($webPolicy -match '(?ms)podSelector:.*component:\s*web.*ingress:.*kubernetes\.io/metadata\.name:\s*envoy-gateway-system.*port:\s*8080') 'Web ingress must be limited to the configured Gateway namespace and container port.'
  $apiPolicy = Resource $network 'NetworkPolicy' '-api'
  Add-Failure ($apiPolicy -match '(?ms)podSelector:.*component:\s*api.*ingress:.*kubernetes\.io/metadata\.name:\s*envoy-gateway-system.*kubernetes\.io/metadata\.name:\s*monitoring.*app\.kubernetes\.io/name:\s*prometheus.*port:\s*8080') 'API ingress must be limited to Gateway and Prometheus peers on the API container port.'
  Add-Failure ($apiPolicy -match '(?ms)egress:.*kubernetes\.io/metadata\.name:\s*kube-system.*k8s-app:\s*kube-dns.*protocol:\s*UDP\s+port:\s*53.*protocol:\s*TCP\s+port:\s*53') 'API egress must include only named DNS peers on TCP/UDP 53.'
  Add-Failure ($apiPolicy -match '(?ms)egress:.*component:\s*mysql.*port:\s*3306') 'API egress must permit MySQL only on port 3306.'
  Add-Failure ($apiPolicy -match '(?ms)cidr:\s*10\.96\.0\.1/32.*port:\s*443.*cidr:\s*10\.20\.0\.5/32.*port:\s*9090') 'API integration egress must render only the configured CIDRs and ports.'
  $mysqlPolicy = Resource $network 'NetworkPolicy' '-mysql'
  Add-Failure ($mysqlPolicy -match '(?ms)podSelector:.*component:\s*mysql.*ingress:.*component:\s*api.*component:\s*migration.*port:\s*3306') 'MySQL ingress must be limited to API and migration pods on port 3306.'

  $openEgressValues = Join-Path $temp.FullName 'network-policy-open-egress.yaml'
  @'
networkPolicy:
  enabled: true
  integrationEgress:
    - name: forbidden-open-egress
      cidr: 0.0.0.0/0
      port: 443
'@ | Set-Content -LiteralPath $openEgressValues -Encoding UTF8
  $openEgressResult = Render-Result $openEgressValues
  Add-Failure ($openEgressResult.ExitCode -ne 0) 'Integration egress 0.0.0.0/0 must be rejected without an explicit reviewed override.'

  $reviewedOpenEgressValues = Join-Path $temp.FullName 'network-policy-reviewed-open-egress.yaml'
  @'
networkPolicy:
  enabled: true
  allowInternetEgress: true
  integrationEgress:
    - name: reviewed-open-egress
      cidr: 0.0.0.0/0
      port: 443
'@ | Set-Content -LiteralPath $reviewedOpenEgressValues -Encoding UTF8
  $reviewedOpenEgressResult = Render-Result $reviewedOpenEgressValues
  Add-Failure ($reviewedOpenEgressResult.ExitCode -eq 0) 'Explicitly reviewed internet egress must remain renderable.'

  $externalDatabaseValues = Join-Path $temp.FullName 'network-policy-external-database.yaml'
  @'
mysql:
  enabled: false
externalDatabase:
  host: mysql.internal.example
  port: 3307
  database: lifeops
  user: lifeops
  existingSecret: lifeops-database
  passwordKey: mysql-password
networkPolicy:
  enabled: true
  externalDatabase:
    cidr: 10.30.0.8/32
    port: 3307
'@ | Set-Content -LiteralPath $externalDatabaseValues -Encoding UTF8
  $externalDatabase = Render $externalDatabaseValues
  $externalApi = Resource $externalDatabase 'NetworkPolicy' '-api'
  $externalMigration = Resource $externalDatabase 'NetworkPolicy' '-migration'
  Add-Failure ($externalApi -match '(?ms)cidr:\s*10\.30\.0\.8/32.*port:\s*3307') 'External-database mode must permit API egress only to the configured database CIDR and port.'
  Add-Failure ($externalMigration -match '(?ms)cidr:\s*10\.30\.0\.8/32.*port:\s*3307') 'External-database mode must permit migration egress only to the configured database CIDR and port.'

  $missingExternalDatabasePolicy = Join-Path $temp.FullName 'network-policy-external-database-missing.yaml'
  @'
mysql:
  enabled: false
externalDatabase:
  host: mysql.internal.example
networkPolicy:
  enabled: true
'@ | Set-Content -LiteralPath $missingExternalDatabasePolicy -Encoding UTF8
  $missingExternalResult = Render-Result $missingExternalDatabasePolicy
  Add-Failure ($missingExternalResult.ExitCode -ne 0) 'Network-isolated external-database mode must reject a missing egress CIDR.'

  $validator = Join-Path $PSScriptRoot 'validate-rendered-helm.ps1'
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $validatorOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $validator -ValuesFile $networkValues -HelmExecutable $script:helm 2>&1 | Out-String
  $validatorExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previous
  Add-Failure ($validatorExitCode -eq 0) "Standalone rendered-Helm validation must pass the reviewed local matrix. Output: $validatorOutput"

  if ($script:failures.Count -gt 0) {
    throw ("rendered-helm-contract failed:`n- " + ($script:failures -join "`n- "))
  }
  Write-Output 'rendered-helm-contract: ok'
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($temp.FullName)
  if (!$resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove unexpected temporary path: $resolvedTemp"
  }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
