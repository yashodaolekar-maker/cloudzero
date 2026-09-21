"""Build an isolated held-out benchmark for the twelve weak-domain v2 adapters."""
import argparse
from pathlib import Path

import build_demo_benchmark as benchmark


V2_TARGETS = {
    target: (f"{target}-adapter-v2", f"{target}-prepared-v2")
    for target in (
        "routing-switching", "dhcp", "cisco-ise", "wireless", "palo-alto",
        "sdwan-zscaler", "silverpeak-edgeconnect", "windows", "linux",
        "devops", "cloudops", "cyber-fusion",
    )
}


if __name__ == "__main__":
    benchmark.TARGETS = V2_TARGETS
    benchmark.main()
