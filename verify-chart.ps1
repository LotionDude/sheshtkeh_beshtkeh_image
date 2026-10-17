param([string]$Helm = 'helm')
$ErrorActionPreference = 'Stop'
$chart = Join-Path $PSScriptRoot 'helm/sheshtkeh-beshtkeh'
& $Helm lint $chart
if ($LASTEXITCODE -ne 0) { throw 'helm lint failed' }

function Render([string[]]$Overrides) {
    $rendered = & $Helm template beta $chart @Overrides 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($rendered -join "`n") }
    return $rendered -join "`n"
}
function Expect([string]$Yaml, [string]$Pattern) {
    if ($Yaml -notmatch $Pattern) { throw "Missing expected chart output: $Pattern" }
}
function Reject([string]$Yaml, [string]$Pattern) {
    if ($Yaml -match $Pattern) { throw "Unexpected chart output: $Pattern" }
}
$default = Render @()
Expect $default 'replicas: 1'
Expect $default 'type: Recreate'
Expect $default 'kind: PersistentVolumeClaim'
Expect $default 'mountPath: /data}'
Expect $default 'readOnlyRootFilesystem: true'
Reject $default 'kind: Route|kind: HorizontalPodAutoscaler|runAsUser:'

$custom = Render @('--set', 'image.registry=registry.example.com:8443,image.repository=beta/sheshtkeh,image.tag=beta-custom,applicationPort=9090', '--set', 'admin.existingSecret=admin-secret,admin.passwordKey=credential,imagePullSecrets[0].name=registry-secret')
Expect $custom 'image: "registry.example.com:8443/beta/sheshtkeh:beta-custom"'
Expect $custom 'containerPort: 9090'
Expect $custom 'value: "9090"'
Expect $custom 'name: registry-secret'
Expect $custom 'name: "admin-secret"'
Expect $custom 'key: "credential"'

$generated = Render @('--set', 'route.enabled=true')
Expect $generated 'kind: Route'
Expect $generated 'termination: edge'
Expect $generated 'targetPort: http'
Reject $generated '(?m)^  host:'
$dns = Render @('--set', 'route.enabled=true,route.host=beta.example.com')
Expect $dns 'host: "beta.example.com"'
$plain = Render @('--set', 'route.enabled=true,route.tls.enabled=false')
Reject $plain '(?m)^  tls:'
$ephemeral = Render @('--set', 'persistence.enabled=false')
Expect $ephemeral 'emptyDir: \{\}'
Reject $ephemeral 'kind: PersistentVolumeClaim|claimName:'
$existing = Render @('--set', 'persistence.existingClaim=beta-data,persistence.storageClass=')
Expect $existing 'claimName: "beta-data"'
Reject $existing 'kind: PersistentVolumeClaim'
$storage = Render @('--set', 'persistence.size=4Gi,persistence.storageClass=beta-storage')
Expect $storage 'storageClassName: "beta-storage"'
Expect $storage 'storage: "4Gi"'
$noClass = Render @('--set-string', 'persistence.storageClass=')
Expect $noClass 'storageClassName: ""'
$example = Render @('-f', (Join-Path $PSScriptRoot 'examples/beta.values.yaml'))
Expect $example 'kind: Route'
Expect $example 'name: "sheshtkeh-admin"'

foreach ($override in @('replicaCount=0', 'replicaCount=2', 'applicationPort=80', 'route.tls.termination=passthrough')) {
    $invalid = & $Helm template beta $chart --set $override 2>&1
    if ($LASTEXITCODE -eq 0) { throw "Invalid configuration accepted: $override" }
}
Write-Output 'PASS: default, registry/tag/port, Secrets, Route, TLS, PVC/emptyDir/existing claim, beta example and invalid deployment guards.'
