[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  podman compose -f compose.yaml ps
  if ($LASTEXITCODE -ne 0) { throw "Podman Compose status failed with exit code $LASTEXITCODE." }
  try {
    $readiness = Invoke-RestMethod -Uri "http://127.0.0.1:3000/readyz" -TimeoutSec 5
    $readiness | ConvertTo-Json -Depth 4
  } catch {
    Write-Warning "The application is not ready yet: $($_.Exception.Message)"
  }
} finally {
  Pop-Location
}
