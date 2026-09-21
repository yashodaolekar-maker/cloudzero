[CmdletBinding()]
param(
  [ValidateSet('up', 'status', 'verify', 'preflight', 'stop')]
  [string]$Action = 'status',
  [string]$Data = '/inputs/prepared',
  [string]$Output = '/workspace/candidate-001'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  switch ($Action) {
    'up' { podman compose -f compose.training.yaml up -d --build }
    'status' { podman ps -a --filter name=cloudzero-training --format '{{.Names}} {{.Status}} {{.Image}}' }
    'verify' { podman exec cloudzero-training python verify_dependencies.py --output /workspace/dependency-verification.json }
    'preflight' { podman exec cloudzero-training python workflow.py preflight --data $Data --output $Output }
    'stop' { podman compose -f compose.training.yaml stop }
  }
  $resultCode = $LASTEXITCODE
  if ($resultCode -ne 0) {
    if ($Action -eq 'preflight' -and $resultCode -eq 2) {
      Write-Host 'Preflight has blockers. Read the report above; no training was started.'
    } else { throw "Training container action failed with exit code $resultCode." }
  }
} finally { Pop-Location }
exit $resultCode
