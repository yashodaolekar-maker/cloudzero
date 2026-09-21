# Network Twin: Silver Peak / HPE Aruba Networking EdgeConnect Operations
Owner: Network Engineering. Review cycle: quarterly. Applicability: EdgeConnect ECOS and Orchestrator; the product was formerly Silver Peak. Confirm the deployed release before using syntax. All configuration changes require HITL approval.

## Progressive triage
Define what is and is not affected: sites, users, applications, start time, recurrence, pre-existing behavior, recent changes, and whether the fault existed before SD-WAN. Follow traffic from ingress classification to the selected Business Intent Overlay, route, bonded tunnel, underlay, cloud service, and destination. Preserve a single UTC incident window and compare affected with unaffected paths.
Source: https://arubanetworking.hpe.com/techdocs/sdwan/docs/troubleshooting/workflow/

## Tunnel state and path quality
Use `show interfaces tunnel summary` for running state. For the named tunnel, use documented variants such as `show interfaces tunnel <tunnel-name> ipsec status`, `show interfaces tunnel <tunnel-name> stats ipsec`, and `show interfaces tunnel <tunnel-name> stats latency`. Correlate tunnel state with WAN interface reachability, alarms, peer scope, IPSec negotiation, MTU, loss, latency, jitter, and resource pressure. A tunnel being up does not prove its path meets the application SLA.
Source: https://arubanetworking.hpe.com/techdocs/sdwan-PDFs/cli-ref/CLI-Reference_latest.pdf

## Business Intent Overlay classification
For traffic missing or entering the wrong BIO, validate application identification, overlay ACL, appliance ACL, LAN port label, template assignment, applied overlays, and top-to-bottom overlay order. In Orchestrator use Configuration > Overlays & Security > Business Intent Overlays and compare with monitored flows. Confirm the desired interfaces and bonding policy when traffic matches the correct BIO but takes the wrong path.
Source: https://arubanetworking.hpe.com/techdocs/sdwan/docs/troubleshooting/overlay_troubleshooting/

## Brownout and performance
EdgeConnect path characterization measures loss, latency, and jitter. Separate WAN loss, high-throughput bonding behavior, MTU mismatch, scanning activity, virtual-appliance resource starvation, and Boost-specific effects. Compare each underlay circuit, bonded tunnel, overlay, traffic class, QoS behavior, and end-to-end application transaction. Use time-series evidence rather than one ping or speed test.
Sources: https://arubanetworking.hpe.com/techdocs/sdwan/docs/videos/ and https://arubanetworking.hpe.com/techdocs/sdwan/docs/orch/monitoring/bandwidth/overlay-int-transport/

## Routing
In Orchestrator use Configuration > Routes and Find Preferred Route for the affected source, destination, direction, and segment. Evaluate longest prefix, administrative distance, metric, EdgeConnect Peer Priority, BGP AS path, and flow-based ECMP in that order. If a fabric route is absent, validate the applicable tunnel or hub path and then inbound or outbound route maps and routing-protocol state.
Source: https://arubanetworking.hpe.com/techdocs/sdwan/docs/troubleshooting/routing/

## Zscaler service orchestration
Service Orchestration creates IPSec IKEv2 tunnels and IP SLA probes for third-party services. Validate loopback prerequisites, remote endpoint information, locally generated IKE IDs, appliance association, tunnel state, and IP SLA monitoring. Pausing or resuming orchestration is an operational change and requires approval. After association, confirm the matched BIO includes Zscaler Cloud in its preferred breakout policy order.
Sources: https://arubanetworking.hpe.com/techdocs/sdwan/docs/orch/configuration/cloud/service-orch/ and https://arubanetworking.hpe.com/techdocs/sdwan-PDFs/user/Orch_UserGuide_R960.pdf

## Appliance discovery
For a new physical appliance, validate cabling, WAN link state, DHCP or approved static addressing, internet access, serial registration, and Orchestrator discovery. For EC-V, verify the management vNIC mapping, required data-path vNICs, account information, and reachability to Orchestrator. Treat management reachability separately from user data-plane health.
Source: https://arubanetworking.hpe.com/techdocs/sdwan/docs/troubleshooting/add_appliance/

## Evidence contract and escalation
Record incident ID, Orchestrator and ECOS versions, appliance and site, segment, BIO, application, interfaces, tunnel names, providers, Zscaler endpoint, UTC window, alarms, path metrics, flows, route decision, change ID, and integrity-bound evidence IDs. Any overlay, route, tunnel, orchestration, QoS, Boost, or interface change needs approval, rollback thresholds, and fresh application validation. Escalate with a support bundle when progressive triage remains inconclusive.
