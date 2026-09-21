# Dedicated Podman training container

The training deployment is `cloudzero-training`, defined by `compose.training.yaml`. It is separate from `cloudzero-digital-twin`, Ollama, the incident databases and the application Compose project. It uses Python 3.12, CUDA PyTorch and the QLoRA libraries in its own image. No host virtual environment is required.

Deployment verified on 12 September 2026: container healthy; Python 3.12.14, PyTorch 2.11.0+cu128, Transformers 4.57.6, PEFT 0.20.0, Accelerate 1.15.0, bitsandbytes 0.50.2 and safetensors 0.8.0. The RTX 3050 passed the tiny NF4/LoRA backward and optimizer test. All 11 workflow tests passed inside the container. Preflight reported only the unready starter dataset. The application remained healthy throughout deployment. Actual reports are saved in `.data/training/container-dependency-verification.json` and `.data/training/container-requirements.lock.txt`.

- `/inputs`: read-only mount of `.data/training/infrastructure-local` for reviewed datasets.
- `/workspace`: persistent `cloudzero_training_workspace` volume for prepared data, cached checkpoints, adapters, comparison results and verification reports.
- No published ports or automatic infrastructure-model training. Startup runs a tiny random-model GPU dependency check and then waits for explicit jobs.
- A passing container health check means the startup NF4/LoRA dependency test passed. It does not mean a reviewed dataset or trained model exists.

## Start and validate

```powershell
powershell -File scripts/podman-training.ps1 -Action up
powershell -File scripts/podman-training.ps1 -Action status
podman logs --tail 30 cloudzero-training
powershell -File scripts/podman-training.ps1 -Action verify
powershell -File scripts/podman-training.ps1 -Action preflight
```

The default preflight reads `/inputs/prepared`. That starter dataset contains no accepted reviewed examples, so a dataset blocker is expected. Dependency and CUDA blockers must be absent after successful deployment. Pass `-Data /workspace/prepared-001` when a new reviewed dataset has been prepared there.

## Prepare and train explicitly

Review/correct the draft examples as described in [LOCAL_TRAINING.md](./LOCAL_TRAINING.md), then:

```powershell
podman exec cloudzero-training python workflow.py prepare --input /inputs/review-drafts.jsonl --output /workspace/prepared-001
podman exec cloudzero-training python workflow.py preflight --data /workspace/prepared-001 --output /workspace/candidate-001
podman exec cloudzero-training python workflow.py train --data /workspace/prepared-001 --output /workspace/candidate-001
```

Use a new output directory for each preparation and training run. For a long run that must survive the terminal closing, invoke training with `podman exec -d` and explicitly redirect its output to a file inside `/workspace` using a fixed container shell command. Check that process and log before starting another run; the trainer does not support concurrent jobs against one GPU. Stopping/recreating the container stops an active training job, though output files remain on the volume.

The configured 0.6B candidate is a separate pilot, not an adapter for the serving 4B checkpoint. The laptop still has only 4 GB VRAM. Dataset length and other GPU workloads affect fit even after the tiny dependency check passes.

Merge and prepare import files using `merge_adapter.py` and `export_candidate.py` inside this container. Copy a finished GGUF to the Ollama container and import under a new candidate name only when ready for comparison. Do not change the app's primary model merely because training finished.

`compare.py` accepts loopback Ollama only. Run a separate comparison job from the training image in Ollama's network namespace so the evaluator still connects locally:

```powershell
podman run --rm --network container:cloudzero-ollama --volume cloudzero_training_workspace:/workspace localhost/cloudzero-training:local python compare.py --data /workspace/prepared-001 --base cloudzero-infra-base:001 --candidate cloudzero-infra-candidate:001 --output /workspace/comparison-001.jsonl
```

Both names must already be installed in Ollama. This command does not start another training process or download a model. For an adapter-improvement claim, the base and candidate must use the same upstream checkpoint and quantization.

## GPU support and recovery

Podman's WSL machine requires NVIDIA's container toolkit base package and a CDI spec. The deployment uses `nvidia.com/gpu=all` and the WSL-provided Windows driver; it does not install a Linux display driver. After a Windows driver update, regenerate the spec if container startup reports stale driver paths:

```powershell
podman machine ssh 'sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml'
```

This follows NVIDIA's [CDI support guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/cdi-support.html). Do not restart the whole Podman machine just to restart training; other applications share the machine.

The interrupted Windows setup is unused: it installed a project-local Python and PyTorch but did not complete the other libraries or GPU test. Those files are retained under `.data/training` rather than deleting data during migration. Container jobs never execute them or mount them. The application container was not rebuilt for this change.

```powershell
podman cp cloudzero-training:/workspace/dependency-verification.json .data/training/container-dependency-verification.json
podman cp cloudzero-training:/workspace/requirements.lock.txt .data/training/container-requirements.lock.txt
```

These capture the actual GPU test and resolved dependency versions. Keep the named volume when rebuilding; `down --volumes` would delete training outputs and model caches.
