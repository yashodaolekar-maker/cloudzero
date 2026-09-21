# Local distilled model for engineering twins

The shared client in `src/server/twin-model.ts` connects conversation and A2A reasoning to Ollama. The selected compact model is `cloudzero-qwen3:4b-q4_K_M`, a local alias pinned to the verified Qwen3-4B **GGUF / Q4_K_M (4-bit)** weights; `qwen2.5:3b` is retained as the fallback for provider failures, incomplete output or invalid structured replies. Qwen3-4B was post-trained with strong-to-weak distillation, as described in [the Qwen team's technical report, section 4.5](https://arxiv.org/html/2505.09388v1#S4.SS5).

This installs an already trained model. It does not train new model weights on your incidents. Role profiles, conversation context, indexed knowledge and persisted incident evidence provide the organization-specific context at inference time. Direct curated knowledge answers can bypass generation. No model is granted device-execution authority.

## Installation and configuration

The local compose stack stores models in the persistent `cloudzero_ollama_models` volume. Install the required models before starting the application on a new machine:

```powershell
podman exec cloudzero-ollama ollama pull qwen3:4b
podman exec cloudzero-ollama ollama pull qwen2.5:3b
powershell -File scripts/pin-twin-quantization.ps1
```

Application configuration:

```dotenv
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=cloudzero-qwen3:4b-q4_K_M
OLLAMA_FALLBACK_MODEL=qwen2.5:3b
OLLAMA_TIMEOUT_MS=60000
```

For host-side evaluation, use `http://localhost:11434`. The client requests non-thinking responses for interactive latency, bounds the output and rejects truncated or empty answers. A2A responses use a JSON schema; the existing reasoning layer separately validates evidence IDs and preserves simulation/verification boundaries. Neither thinking fields nor embedded reasoning blocks are returned as spoken answers. Fallback can take an additional timeout interval; if both models fail, the role-specific deterministic guidance remains available.

`GET /api/engineering/model` reports configured and installed models, reachability, the model digest, actual GGUF format and quantization from Ollama, and the most recently completed model attempt. `lastRun.usedFallback` makes fallback observable; it is global runtime status, not a per-user conversation log.

## Evaluation

```powershell
npx tsx scripts/evaluate-twin-model.ts
npm run test:engineering
npm run lint
```

The evaluation runs five role questions plus a structured maintenance handoff with fallback disabled. Its automated checks verify complete responses and valid structure, not expert-level correctness; inspect the printed final answers. No reasoning traces are printed. DeepSeek-R1-Distill-Qwen-1.5B was also evaluated locally but was not selected: it exhausted short response budgets and produced an inaccurate ASA answer in a direct test.

Ollama references: [thinking controls](https://docs.ollama.com/capabilities/thinking), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs).

## Quantization

The installed source was already Q4_K_M; pinning it copies an Ollama model name, not the weight data, and does not requantize the model. The local alias retains the tested manifest if the source tag is subsequently updated. Model files remain in the persistent Ollama volume. The default uses 4-bit weights to keep memory requirements lower on this local machine. Q4_K_M is a mixed quantization scheme, not a claim that every tensor is exactly four bits.

The pinning script checks the actual format, family, size and quantization before creating an alias. If a future source download has different quantization, it fails instead of silently relabeling it. For an already installed Qwen3-4B Q8_0 GGUF, pass `-SourceModel <installed-model-name> -Quantization Q8_0`; then explicitly change `OLLAMA_MODEL` to the resulting alias and recreate the application. No 8-bit model is installed or selected by this change.
