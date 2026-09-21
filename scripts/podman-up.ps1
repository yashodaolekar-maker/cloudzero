[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  podman compose -f compose.yaml up -d --build
  if ($LASTEXITCODE -ne 0) { throw "Podman Compose build/start failed with exit code $LASTEXITCODE." }
  podman compose -f compose.yaml ps
  if ($LASTEXITCODE -ne 0) { throw "Podman Compose status failed with exit code $LASTEXITCODE." }
  Write-Host "CloudZero is starting at http://localhost:3000"
} finally {
  Pop-Location
}
