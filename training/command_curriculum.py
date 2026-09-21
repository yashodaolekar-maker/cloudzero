"""Create unreviewed command-evidence A2A exercises for network/host validation."""
import argparse
import json
from pathlib import Path

CASES = [
    ("switch", "NETWORK", "WINDOWS", "show ip interface brief", "Vlan220 up up; Gi1/0/24 up up", "Get-NetIPConfiguration", "Ethernet0 IPv4 present; gateway configured"),
    ("router", "NETWORK", "WINDOWS", "show ip route summary", "connected and learned route counts returned", "Test-NetConnection -ComputerName app-service -InformationLevel Detailed", "TcpTestSucceeded=False"),
    ("firewall", "NETWORK", "WINDOWS", "show session all filter source affected-client destination app-service", "No matching session found", "Resolve-DnsName -Name app-service -DnsOnly", "Name resolved to the expected service alias"),
    ("wlc", "NETWORK", "WINDOWS", "show wireless client mac-address affected-client detail", "Client associated; authentication pending", "Get-WinEvent -FilterHashtable @{LogName='System';Level=2} -MaxEvents 25", "No correlated system error in incident window"),
    ("access-point", "NETWORK", "WINDOWS", "show wireless client mac-address affected-client detail", "Roam reason and policy state returned", "Test-NetConnection -ComputerName app-service -InformationLevel Detailed", "Destination reachable after association"),
    ("sdwan", "NETWORK", "WINDOWS", "show sdwan control connections", "One control connection down", "Get-NetRoute -AddressFamily IPv4 | Sort-Object RouteMetric | Select-Object -First 20", "Expected default route selected"),
]


def rows():
    for index, (family, owner, peer, network_command, network_output, host_command, host_output) in enumerate(CASES, 1):
        evidence = [
            {"id": f"draft-net-{index}", "persona": owner, "status": "SIMULATED", "command": network_command, "output": network_output},
            {"id": f"draft-host-{index}", "persona": peer, "status": "SIMULATED", "command": host_command, "output": host_output},
        ]
        yield {
            "trainingReady": False,
            "exclusion": "Draft command-evidence exercise; a network and Windows engineer must review commands, outputs and conclusion.",
            "messages": [
                {"role": "system", "content": "Act as a network engineering twin. Cite only supplied evidence. Explain what each check supports, what it cannot exclude, and the next discriminating read-only check. Never claim a team is cleared from one successful check."},
                {"role": "user", "content": json.dumps({"deviceFamily": family, "question": "Assess network versus Windows ownership and prepare an evidence-backed handoff.", "evidence": evidence})},
                {"role": "assistant", "content": json.dumps({"assessment": "Draft: correlate the network-path observation with the host observation; neither result alone clears an entire team.", "nextCheck": "Draft: select the next allowlisted check that distinguishes the remaining hypotheses.", "evidenceIds": [item["id"] for item in evidence]})},
            ],
            "provenance": {"domain": "NETWORK", "incidentId": f"DRAFT-CMD-{index}", "incidentFamily": f"command-validation:{family}", "mode": "SIMULATION", "source": "DRAFT_COMMAND_CURRICULUM", "reviewerId": "", "reviewEventId": ""},
            "reviewChecklist": ["Command is read-only and valid for the stated platform", "Output supports the stated inference", "No team-wide clearance from a partial check", "Evidence IDs match", "Next check distinguishes remaining causes"]
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("x", encoding="utf-8") as output:
        for row in rows():
            output.write(json.dumps(row, ensure_ascii=False) + "\n")
    print(f"Created {len(CASES)} unreviewed command-evidence exercises at {args.output}")


if __name__ == "__main__":
    main()
