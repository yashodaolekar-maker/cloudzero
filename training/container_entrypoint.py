"""Validate the dedicated GPU environment, then remain available for podman exec jobs."""
import json
import subprocess
import sys
from pathlib import Path

workspace = Path('/workspace')
ready = workspace / 'container-ready'
ready.unlink(missing_ok=True)
subprocess.run([sys.executable, 'verify_dependencies.py', '--output',
                str(workspace / 'dependency-verification.json')], check=True)
result = subprocess.run([sys.executable, '-m', 'pip', 'freeze'], capture_output=True, text=True, check=True)
(workspace / 'requirements.lock.txt').write_text(result.stdout, encoding='utf-8')
ready.write_text('Dependency verification passed\n', encoding='utf-8')
print(json.dumps({'status': 'READY', 'trainingStarted': False,
                  'message': 'Dedicated training container ready with reviewed-learning control plane.'}), flush=True)
subprocess.run([sys.executable, 'control_plane.py'], check=True)
