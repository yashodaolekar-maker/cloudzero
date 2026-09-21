[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
  # The named incident-data volume is intentionally retained.
  podman compose -f compose.yaml down
  if ($LASTEXITCODE -ne 0) { throw "Podman Compose shutdown failed with exit code $LASTEXITCODE." }
} finally {
  Pop-Location
}
