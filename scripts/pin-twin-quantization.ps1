param(
    [string]$SourceModel = 'qwen3:4b',
    [ValidateSet('Q4_K_M', 'Q8_0')][string]$Quantization = 'Q4_K_M'
)
$ErrorActionPreference = 'Stop'
$details = (Invoke-RestMethod -Uri 'http://localhost:11434/api/show' -Method Post -ContentType 'application/json' -Body (@{ model = $SourceModel } | ConvertTo-Json)).details
if ($details.format -ne 'gguf' -or $details.quantization_level -ne $Quantization -or $details.family -ne 'qwen3' -or $details.parameter_size -notmatch '^4(?:\.0)?B$') {
    throw 'Source must be a Qwen3 4B GGUF with the requested quantization. No alias was created.'
}
$quantizationAlias = 'cloudzero-qwen3:4b-' + $Quantization.ToLowerInvariant().Replace('q4_k_m', 'q4_K_M')
& podman exec cloudzero-ollama ollama cp $SourceModel $quantizationAlias
if ($LASTEXITCODE -ne 0) { throw 'Ollama could not pin the quantized model.' }
Write-Output "Verified $Quantization GGUF pinned as $quantizationAlias. Set OLLAMA_MODEL to this name and recreate the app container to activate it."
