# Train an infrastructure pilot on this laptop

**Deployment update:** the preferred workflow now runs in the [separate Podman training container](./CONTAINER_TRAINING.md). The host virtual-environment instructions below are historical alternatives; they are not required for container jobs.

This workflow stays on the laptop. It prepares one shared adapter across Networking, Windows, DevOps, CloudOps and defensive Security. It does not provision cloud resources or upload incidents.

The default is a **separate Qwen3-0.6B feasibility pilot**, pinned to upstream commit `c1899de289a04d12100db370d81485cdf75e47ca`. This is smaller than the app's current 4B model; it is not an adapter for that model and cannot be merged into it. The current Ollama primary remains unchanged. The 4 GB GPU clears the small recipe's initial capacity check, but an actual GPU run is still needed to establish memory fit and training compatibility.

## Start with reviewed examples

Run commands from the project root. Data preparation works with the existing Python installation and requires no training packages.

```powershell
python training/workflow.py init --output .data/training/infrastructure-local/review-drafts.jsonl
```

This creates 25 **unreviewed draft answers**, five per domain. They deliberately cover missing-evidence investigations. They are a starting curriculum, not a sufficient training set and not expert-reviewed ground truth. Add evidence-rich cases, misleading signals, verified resolutions, failed repairs, cross-team handoffs and ambiguous cases. Avoid simply duplicating questions to meet counts.

An engineer reviews and corrects each final assistant answer, which is JSON containing an `answer` string. Set `trainingReady` to true only after review, remove `exclusion`, and fill in `provenance.reviewerId` and a real review record identifier in `provenance.reviewEventId`. Keep `mode` as `SIMULATION` for fictional examples. Use one `incidentFamily` for variants of the same underlying incident. Never turn synthetic examples into records claiming production outcomes.

Alternatively, use **Digital Twins → Activity & reviews → training export** for reviewed real application examples. Existing exports retain the domain from `task.role`; the workflow copies it into provenance. Add incident-family identifiers when several incidents share a scenario. Review exported text for credentials and personal data before using it; external JSONL imports are not an automatic secret scrubber.

```powershell
python training/workflow.py prepare --input .data/training/infrastructure-local/review-drafts.jsonl --output .data/training/infrastructure-local/prepared-001
```

Read `readiness.json`. The five-domain workflow requires at least 20 reviewed examples per domain and representation in both training and validation. This is a pilot floor, not an accuracy guarantee. Incident and family links stay in the same split; duplicates are excluded. The split is deterministic. A domain without held-out coverage blocks the pilot: add independent families rather than relabeling near-duplicate cases. Preparation returns exit code 2 when data is not ready and saves the reasons. Output folders are never overwritten.

## Local training environment

The project now has a separate managed Python 3.12 at `.data/training/python` and a virtual environment at `.data/training/venv`. Use `.data/training/venv/Scripts/python.exe` for training commands; activation is optional. System Python installations are unchanged. On a fresh machine with Python 3.12 already installed, create the environment with:

```powershell
py -3.12 -m venv .data/training/venv
.data/training/venv/Scripts/python.exe -m pip install --upgrade pip
```

Install CUDA-enabled PyTorch using the Windows/Pip/CUDA command from the [official PyTorch selector](https://pytorch.org/get-started/locally/) for the installed NVIDIA driver. Run that pip command with the venv Python above. Then:

```powershell
.data/training/venv/Scripts/python.exe -m pip install -r training/requirements.txt
.data/training/venv/Scripts/python.exe training/workflow.py preflight --data .data/training/infrastructure-local/prepared-001 --output .data/training/infrastructure-local/candidate-001
```

Preflight does not download weights. It checks the pinned revision, recipe, Python, packages, prepared dataset hashes and GPU memory. Exit code 2 means blockers remain. Close other GPU workloads if free VRAM is insufficient; the scripts do not stop the application or unload its models automatically. The package ranges are a setup recipe, not a GPU-tested lockfile. After a successful environment setup, retain `pip freeze` with the training record.

To check actual GPU library compatibility without downloading or training an infrastructure model:

```powershell
.data/training/venv/Scripts/python.exe training/verify_dependencies.py --output .data/training/dependency-verification.json
```

This creates a tiny random Qwen3 model temporarily, loads its linear layers in NF4, attaches LoRA adapters, and checks a backward/optimizer step. It does not establish that a full training run fits in VRAM.

When preflight passes:

```powershell
.data/training/venv/Scripts/python.exe training/workflow.py train --data .data/training/infrastructure-local/prepared-001 --output .data/training/infrastructure-local/candidate-001
```

This downloads the pinned public checkpoint to this laptop and runs QLoRA locally: NF4, rank 8 on query/value projections, batch size 1, gradient accumulation, checkpointing, 512-token sequences and one epoch. Reviewed answers exceeding the token limit fail rather than being truncated. Training saves a manifest, held-out loss and adapter; it does not alter the serving model. More aggressive all-linear adaptation can be evaluated later on hardware with adequate headroom.

## Export and compare

Merge the adapter into its **own exact upstream base**, using CPU RAM:

```powershell
.data/training/venv/Scripts/python.exe training/merge_adapter.py --run .data/training/infrastructure-local/candidate-001 --output .data/training/infrastructure-local/merged-001
```

Convert the merged Hugging Face directory using a compatible local [llama.cpp](https://github.com/ggml-org/llama.cpp) checkout's `convert_hf_to_gguf.py`, then quantize with its `llama-quantize` executable. These external tools are not installed by this workflow. The resulting GGUF must contain the complete merged model, not just LoRA tensors. Re-evaluate after quantization.

```powershell
python training/export_candidate.py --gguf .data/training/infrastructure-local/candidate-Q4_K_M.gguf --output .data/training/infrastructure-local/import-001
```

That command checks the GGUF header, records its SHA-256 and writes a Modelfile. It does not import or promote the model. Import under a new name using `ollama create` and the [official import instructions](https://docs.ollama.com/import). With this project's Podman Ollama, copy the GGUF and Modelfile into `cloudzero-ollama`, use a container-local `FROM` path, and run `podman exec cloudzero-ollama ollama create cloudzero-infra-candidate:001 -f <container-Modelfile>`. The host-side absolute path generated by the helper is for host Ollama; it is not a container path.

For an adapter-improvement claim, import an untrained GGUF from the **same pinned 0.6B checkpoint**, with the same quantization, as the comparison baseline. Comparing a 0.6B candidate against the current 4B model answers a separate model-choice question and does not isolate the effect of training.

```powershell
python training/compare.py --data .data/training/infrastructure-local/prepared-001 --base cloudzero-infra-base:001 --candidate cloudzero-infra-candidate:001 --output .data/training/infrastructure-local/comparison-001.jsonl
```

The evaluator uses only held-out validation examples, with reference answers excluded from prompts. Both models must already be installed; it never silently falls back. It records final outputs, model digests, timing, reported tokens and failures. Requests are sequential and unload the requested model afterward to reduce local memory pressure. Timing includes loading; it is not a warm-serving latency benchmark. Human reviewers fill in correctness, evidence support and next-check usefulness. Structural validity and held-out loss do not prove domain accuracy.

Keep current runbooks in the application's existing knowledge index. QLoRA teaches response behavior and recurring patterns; current product versions and organization-specific facts still need retrieval. The existing [knowledge ingestion runbook](../KNOWLEDGE_INGESTION.md) describes this path.

The specialty generator includes `routing-switching`, `palo-alto`, `cisco-ise`, `wireless`, and `sdwan-zscaler`. The SD-WAN/Zscaler set contains five isolated incident families covering controller identity, BFD underlay health, application-aware routing, ZIA service-edge latency, and forwarding capacity. These synthetic records support a demo candidate only; evaluate them against unseen cases and require a domain reviewer before shadow promotion.

`generate_domain_mastery_demo.py` creates the first auditable mastery seed for Windows, Linux, Security/Cyber Fusion, DevOps, and CloudOps. Every response ranks hypotheses, names discriminating checks, summarizes its evidence logic, defines cross-twin handoffs, and includes temporary fix, permanent fix, verification, rollback, escalation, confidence, and simulation provenance. It intentionally does not generate hidden chain-of-thought. Twenty synthetic examples per domain are enough to exercise the pipeline, not enough to claim senior-engineer mastery.

Build deeper coverage incrementally. For each domain, add independent incident families across routine failures, ambiguous symptoms, misleading signals, partial telemetry, failed remediations, vendor defects, capacity events, security boundaries, disaster recovery, and multi-domain dependencies. Keep product facts and current commands in the cited knowledge index. Use reviewed incident outcomes for supervision only after redaction and provenance validation. Maintain separate unseen golden cases and require independent scores for root-cause accuracy, evidence traceability, command accuracy, and safe abstention before shadow promotion.

## Verification and present limits

```powershell
python -m unittest discover -s training -p "test_*.py"
```

Preparation, draft exclusion, group isolation, domain gates, local-only evaluation and error accounting have automated coverage. GPU training, merging, conversion and candidate benchmarking have not yet run on this laptop. No adapter or new accuracy result exists until a reviewed dataset and compatible environment are available. These are local training tools, so rebuilding the application container is unnecessary for this workflow.
