# Network Twin: Routing and Switching Vendor Core

Owner: Network Engineering. Review cycle: quarterly. Applicability: Cisco IOS/IOS-XE/NX-OS, HPE Aruba AOS-CX/ArubaOS-Switch, Juniper Junos, Arista EOS, and vendor-neutral Ethernet/IP operations. Confirm platform and release before using syntax. Read-only diagnostics by default; all changes require HITL approval.

## Required mental model

Trace the affected flow in both directions: endpoint, access port or WLAN, VLAN, trunk, gateway, routing table, forwarding table, ACL/firewall, WAN or overlay, service endpoint, and return path. Distinguish control-plane state from data-plane forwarding and device health from customer transaction health.

## Layered triage

Define scope and a known-good comparison. Validate link state, errors, speed/duplex, optics, MAC learning, VLAN membership, trunk allowance and native VLAN, STP state, gateway reachability, ARP/ND, DHCP relay, route presence, next hop, FIB/CEF programming, ACL counters, MTU, and return path. Correlate with timestamps and recent changes. A port being up, a route being present, or a ping succeeding does not prove application health.

## Vendor-neutral command families

Use the platform equivalent of: interface status and counters; MAC address table; VLAN and trunk state; spanning-tree topology; ARP/ND; route and forwarding lookup for source/destination; routing-protocol neighbors and received/advertised prefixes; ACL or policy counters; interface and path MTU; and packet capture or flow telemetry where approved. Record the exact command, target, time, and output hash.

## Cisco reference families

IOS/IOS-XE commonly uses `show interfaces`, `show interfaces counters errors`, `show vlan`, `show interfaces trunk`, `show spanning-tree`, `show mac address-table`, `show ip arp`, `show ip route`, `show ip cef`, `show ip ospf neighbor`, `show bgp summary`, and `show access-lists`. NX-OS uses the corresponding NX-OS forms and may differ in routing and hardware forwarding details. Validate syntax against the installed release and never infer a missing feature from a command error alone.

## HPE Aruba reference families

AOS-CX commonly uses `show interface`, `show vlan`, `show interface vlan`, `show spanning-tree`, `show mac-address-table`, `show arp`, `show ip route`, `show ip ospf neighbor`, `show bgp summary`, and ACL or policy inspection commands. ArubaOS-Switch syntax differs materially. Confirm whether the device is AOS-CX or legacy ArubaOS-Switch before giving a command.

## Juniper reference families

Junos commonly uses `show interfaces terse`, `show interfaces extensive`, `show vlans`, `show ethernet-switching table`, `show spanning-tree`, `show arp`, `show route`, `show route forwarding-table`, `show ospf neighbor`, `show bgp summary`, and `show configuration | display set` for reviewed configuration evidence. Separate active configuration, candidate configuration, and operational state. Do not suggest commit, rollback, or clear operations without approval.

## Arista and other vendors

EOS, Huawei, Nokia, MikroTik, and appliance platforms have different nomenclature and forwarding behavior. Use the same evidence model but retrieve the platform-specific approved runbook. If no reviewed procedure exists for the model and release, return the vendor, version, missing runbook, and safe evidence request rather than guessing commands.

## Core failure patterns

For VLAN mismatch, compare endpoint assignment, access/trunk tagging, allowed VLANs, native VLAN, gateway SVI, DHCP relay, and MAC learning. For routing asymmetry, compare both direction route lookups, next hops, ECMP, policy routing, NAT, ACL state, and return advertisements. For STP incidents, identify root bridge, port role/state, topology changes, loops, blocked paths, and change timing. For packet loss, separate interface errors, congestion, policing, MTU/fragmentation, underlay loss, tunnel loss, and application retransmission.

## Escalation and recovery

Escalate to the carrier for persistent underlay impairment; to the firewall/security owner for policy or NAT evidence; to the platform vendor when forwarding and control-plane evidence conflict; and to the application owner when network health is proven but transactions fail. Before an approved change, capture state and define rollback. Afterward validate the customer flow, error rate, latency, and return path over a stated observation window.
