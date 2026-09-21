# Network Twin: Cisco SD-WAN and Zscaler ZIA Operations
Owner: Network Engineering. Review cycle: quarterly. Applicability: Cisco Catalyst SD-WAN and Zscaler Internet Access. All commands are read-only; configuration changes require HITL approval.

## Control plane and identity
Start with `show sdwan control connections`. If sessions are absent, correlate controller reachability, routes, DNS for controller names, organization identity, installed certificates, certificate validity, and clock state. Use `show sdwan certificate installed` and the platform-approved time checks. Do not infer an underlay fault solely from a missing control connection.
Source: https://www.cisco.com/c/en/us/support/docs/routers/sd-wan/222302-troubleshoot-common-sd-wan-control-and-d.pdf

## Data plane and BFD
Use `show sdwan bfd sessions`, then `show sdwan tunnel statistics`. Separate control-plane health from data-plane failure. Compare loss, latency, jitter, MTU, NAT, transport color, carrier events, and tunnel counters in one incident window. A stable controller session does not prove an application tunnel is healthy.
Source: https://www.cisco.com/c/en/us/td/docs/routers/sdwan/26x-later/routing/routing-configuration-guide/bfd/troubleshoot-common-bfd-errors.html

## Application-aware routing
Use `show sdwan app-route stats` and `show sdwan policy from-vsmart`. Confirm the application class, SLA thresholds, preferred and fallback colors, local measurements, and installed policy revision. Validate whether a path is actually out of SLA before recommending steering. Recheck application probes after any approved policy change.
Source: https://www.cisco.com/c/en/us/td/docs/routers/sdwan/configuration/policies/ios-xe-17/policies-book-xe/application-aware-routing.html

## Zscaler forwarding and latency
Identify transparent GRE/IPsec, explicit PAC, or Client Connector forwarding before testing. For a fixed site, validate primary and backup tunnel diversity, tunnel utilization, flow persistence, and reachability to the ZIA service beyond the tunnel interface. Use Zscaler Cloud Performance Test for browser-to-service measurements; ICMP alone is not a valid performance conclusion because service-edge ICMP can be deprioritized.
Sources: https://help.zscaler.com/zia/best-practices-deploying-gre-tunnels and https://help.zscaler.com/zia/measuring-performance-zscaler-service

## Escalation and recovery evidence
Before failover, record incident ID, site, edge, transport color, ZIA cloud and service edge, tunnel IDs, policy revision, UTC window, application probes, and rollback thresholds. Failover or policy changes require Network and Security approval. Escalate to the carrier when underlay loss persists, to Cisco when control/BFD evidence is inconclusive, and to Zscaler when the underlay is healthy but service-edge testing remains degraded.
