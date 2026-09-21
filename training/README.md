# Reviewed engineering model improvement

**Current deployment:** use the [dedicated Podman training container](./CONTAINER_TRAINING.md). It isolates dependencies, GPU checks and training outputs from the application and the interrupted Windows virtual-environment setup.

For the simplified five-domain, laptop-only workflow, start with [LOCAL_TRAINING.md](./LOCAL_TRAINING.md). It includes a separate 0.6B QLoRA pilot for the 4 GB laptop, draft curriculum, domain coverage checks, preflight and candidate comparison. The original 4B recipe below remains available for suitable hardware.

This project cannot reproduce Astra's private weights or guarantee equivalent accuracy. The running model remains the verified `cloudzero-qwen3:4b-q4_K_M` GGUF in Ollama. **No new weights have been trained by this change.** The files here prepare and run an auditable, supervised QLoRA pilot when reviewed data and suitable hardware exist.

## What is trained

Final, human-reviewed answers and structured A2A assessments, not hidden reasoning traces. A dataset entry retains its incident, mode, reviewer, decision event and review revision. A wrong answer must have a correction. Unreviewed answers, inconclusive reviews and unrelated diagnostic work are not silently turned into supervision. A2A corrections used for training must contain valid JSON with `assessment`, `nextCheck`, and known `evidenceIds`.

In Digital Twins → Activity & reviews, inspect a task and its evidence, review it, then explicitly select inclusion in training exports. Export reviewed examples. The latest review counts; earlier revisions remain in the ledger. Redaction is applied, but review operational data before moving it outside your organization. No data is sent to a teacher API or external training service automatically.

```powershell
python training/prepare.py .data/twin-reviewed-training.jsonl --output .data/training/pilot
```

Simulation is excluded by default. Add `--include-simulation` only for a deliberate simulation curriculum. The split holds whole incident groups out of training and removes duplicate prompts to reduce evaluation leakage. A pilot requires at least 20 reviewed examples across five incident groups. This small pilot minimum is **not** a production quality threshold; build broader coverage for Network, Windows, Linux, CloudOps and DevOps, failure recovery, evidence validation, A2A maintenance handoffs, SLA interpretation and user-journey XLA.

## Hardware and preflight

The checked laptop has a 4 GiB RTX 3050 and 16 GiB system RAM. Its working GGUF inference is separate from weight training. This conservative 4B QLoRA recipe requires at least 6 GiB CUDA VRAM (8 GiB or more preferable) and training dependencies. That is a guard for this recipe, not a claim that all methods require that much VRAM. No training packages or multi-gigabyte upstream weights are automatically installed on the serving machine.

On a suitable, explicitly selected training machine, install compatible PyTorch/CUDA, Transformers, PEFT, Accelerate and bitsandbytes in an isolated environment. Follow the [PEFT quantization guide](https://huggingface.co/docs/peft/developer_guides/quantization). The current trainer was syntax/preparation-tested locally; the GPU training path remains unexecuted.

The trainer requires the exact upstream Hugging Face checkpoint and immutable revision. Do not assume an Ollama tag maps to a similarly named Hugging Face checkpoint; the installed GGUF metadata includes a Thinking finetune label. Match the checkpoint/tokenizer before training or merging an adapter.

```powershell
python training/finetune.py --data .data/training/pilot --base-model <verified-upstream-repository> --revision <40-character-commit-sha> --output .data/training/candidate-001 --preflight
# On the prepared training host, use the same command without --preflight to run the pilot.
```

The pilot uses 4-bit NF4 base loading, rank-8 LoRA, masked prompt loss, gradient checkpointing and held-out loss evaluation. It refuses to truncate reviewed targets or overwrite an existing adapter output. It never changes the live model. Training quantization (NF4) is different from the final serving GGUF quantization (Q4_K_M or Q8_0).

## Evaluate and promote

1. Compare the base and candidate on held-out engineering cases. Score correctness, supported evidence, uncertainty, next-check usefulness, A2A evidence binding, response latency and task success. Human review is required; lower validation loss alone is insufficient.
2. Include the user's commitments: P1 resolution 1 hour, P2 8 hours; XLA measures service journeys such as AP-to-AP wireless continuity. A fast agent response does not prove the user had a good experience.
3. Merge a validated adapter into its exact upstream base checkpoint on the training machine. Convert the merged checkpoint with a compatible llama.cpp conversion tool and quantize to Q4_K_M or Q8_0. Verify model/tokenizer compatibility and re-evaluate the quantized artifact.
4. Import the candidate GGUF under a **new** Ollama name following [Ollama's import guide](https://docs.ollama.com/import). Compare it with the existing primary using the application's evaluation scripts. Only then select it as `OLLAMA_MODEL`; retain the old alias for rollback.

No base-model export, adapter merge, GGUF conversion, candidate promotion or accuracy claim is made until those steps actually succeed.

## Runtime twin identities

The live orchestrator currently specializes the local model at request time. The role profile in `src/server/engineer-conversation.ts` is the source of truth for Network, Windows, Security, DevOps, CloudOps, Database and Linux identity, ordered SOP steps, overlap handoffs and evidence requirements. The incident classifier selects the role, and the same profile is injected into both conversational and A2A collaboration prompts. This works with the configured Ollama model without claiming that an adapter was trained.

For an adapter pilot, collect reviewed examples for one domain at a time and keep the role in the system message. Prepare and hold out incident groups as usual:

```powershell
python training/prepare.py .data/twin-reviewed-training.jsonl --output .data/training/network-pilot
python training/finetune.py --data .data/training/network-pilot --base-model <verified-qwen3-checkpoint> --revision <40-character-commit-sha> --output .data/training/network-adapter --preflight
```

After training, benchmark the candidate against the same domain's held-out incidents and cross-functional handoffs. Merge and quantize only after human review, import the resulting GGUF under a new Ollama name, and test it before changing `OLLAMA_MODEL` in the local compose configuration. Keep the current model as `OLLAMA_FALLBACK_MODEL` for rollback. A GPT/Astra-compatible provider must preserve the same system identity, SOP, structured evidence schema and no-unverified-execution rules; this repository currently implements the serving path through Ollama.
