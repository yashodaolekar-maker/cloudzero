# CloudZero Demo Critical Incident Verification SOPs

Approved simulation-aligned verification guidance for CloudZero demo incidents. These procedures require read-only evidence collection before diagnosis. They never authorize remediation.

## False Network Symptom — Middleware Connection Exhaustion
[VERIFY] Confirm DNS resolution, packet loss, and application-path latency before retaining a network hypothesis. [VERIFY] Compare middleware active connections with configured pool capacity and count waiting requests. [VERIFY] Confirm database sessions, waits, and query latency remain within baseline. [STOP] Do not increase capacity or recycle an instance until middleware saturation is supported and Network and Database hypotheses are eliminated. [ROLLBACK] Preserve the previous pool setting and instance configuration. [VERIFY] After an approved change, confirm waiting requests clear and checkout requests recover.

## Windows DNS Did Not Restart After Patching
[VERIFY] Confirm interface state, DNS endpoint reachability, and packet loss from the affected host. [VERIFY] Inspect the Windows DNS service state and relevant post-maintenance events. [VERIFY] Compare the patch window with the first failed resolution. [STOP] Do not alter network routing when interfaces are up and only the DNS service is stopped. [VERIFY] After approved recovery, repeat local and remote name-resolution tests.

## Database Connection Pool Saturation
[VERIFY] Measure active connections, configured maximum, waiting requests, and query latency. [VERIFY] Confirm Linux service health and resource pressure are not the limiting condition. [VERIFY] Confirm the network path has no packet loss or reachability failure. [STOP] Do not restart or resize the pool from an initial symptom alone. [VERIFY] After approved recovery, confirm waiting orders clear and latency returns to baseline.

## Access VLAN Mismatch
[VERIFY] Compare the observed access VLAN with the CMDB-assigned application segment. [VERIFY] Confirm interface operational state and inspect the most recent switch-port change. [VERIFY] Confirm the Windows host service is healthy before assigning ownership. [STOP] Do not change a trunk or access port until the target interface and expected VLAN are evidence-bound. [VERIFY] After approval, confirm application reachability and the final VLAN assignment.

## Wireless Roaming Session Loss
[VERIFY] Reproduce one controlled roam and measure handoff interruption and session continuity. [VERIFY] Confirm authentication services remain available throughout the handoff. [VERIFY] Compare controller, AP, client, RF, 802.11r/k/v, and mobility-domain evidence for the same timestamp. [STOP] Do not tune RF or roaming profiles from a single client report. [VERIFY] After an approved profile correction, repeat roaming tests across the affected AP pair.

## Tunnel Path MTU Failure
[VERIFY] Test progressively larger packets with fragmentation disabled and record the largest delivered size. [VERIFY] Compare tunnel overhead, endpoint packet size, retransmissions, and fragmentation counters. [VERIFY] Confirm the Linux service is healthy and small requests succeed. [STOP] Do not change routing while reachability works and failure correlates with packet size. [VERIFY] After approval, repeat small and large request delivery tests.

## Kerberos Failure from Clock Drift
[VERIFY] Measure host clock offset against the approved domain time source. [VERIFY] Confirm Kerberos failure and review time-service events for the same window. [VERIFY] Confirm the network path is reachable without packet loss. [STOP] Do not reset credentials or domain trust before validating time synchronization. [VERIFY] After approved correction, repeat time and Kerberos authentication checks.

## IIS Application Pool Stopped
[VERIFY] Confirm application-pool state, recent IIS events, and the observed HTTP status. [VERIFY] Compare deployment time with the first pool failure. [VERIFY] Confirm the DevOps deployment controller is healthy and identify the last known-good release. [STOP] Do not recycle repeatedly without preserving the failure evidence. [VERIFY] After approval, confirm the pool remains running and HTTP returns success.

## Database Blocking Transaction
[VERIFY] Identify the blocking transaction, blocked sessions, wait duration, and affected queries. [VERIFY] Confirm Linux service and resource health are not causing generalized delay. [VERIFY] Preserve transaction and lock evidence before proposing termination. [STOP] Do not terminate a transaction without owner review and rollback impact. [VERIFY] After approval, confirm blocked requests clear and no new blocker appears.

## Database Replica Lag
[VERIFY] Measure replica lag and inspect replay, receiver, and primary WAL states. [VERIFY] Confirm network reachability and packet loss between primary and replica. [VERIFY] Compare lag onset with maintenance or replication configuration changes. [STOP] Do not promote or rebuild a replica from lag alone. [VERIFY] After approval, confirm replay is active and lag converges.

## Database Log Volume Full
[VERIFY] Confirm log-volume utilization, write failures, and growth source. [VERIFY] Confirm the filesystem is mounted and writable from Linux evidence. [VERIFY] Validate retention, archive, and backup status before removing files. [STOP] Do not delete database logs manually. [VERIFY] After approved capacity recovery, confirm writes succeed and utilization remains below the alert threshold.

## Linux Root Filesystem Full
[VERIFY] Measure filesystem and inode utilization and identify the largest growth sources. [VERIFY] Inspect log-rotation state and recent failures. [VERIFY] Confirm the DevOps workload is healthy before deleting or moving artifacts. [STOP] Do not remove unknown files from a critical host. [VERIFY] After approval, confirm rotation is active, capacity is stable, and the service is healthy.

## Linux Systemd Configuration Failure
[VERIFY] Inspect systemd status, configuration validation output, and relevant journal events. [VERIFY] Compare the active configuration with the last known-good version. [VERIFY] Confirm network reachability is healthy before assigning ownership. [STOP] Do not repeatedly restart a service with an invalid configuration. [VERIFY] After approved rollback or correction, confirm configuration validation and sustained service health.

## Linux Mounted Directory Permissions
[VERIFY] Confirm the application identity, mount state, ownership, mode, ACL, and a read test using the service identity. [VERIFY] Confirm the database dependency remains healthy. [VERIFY] Compare permission metadata with the approved baseline and recent changes. [STOP] Do not apply broad recursive permissions. [VERIFY] After approval, confirm least-privilege access and application recovery.

## Cloud Subnet Route Wrong Next Hop
[VERIFY] Compare the effective subnet route with the approved route-table baseline. [VERIFY] Test next-hop health and reachability without changing the route. [VERIFY] Confirm the downstream network path remains healthy. [STOP] Do not replace a route until account, region, subnet, route table, and expected appliance are verified. [VERIFY] After approval, confirm effective routing and application reachability.

## Cloud Instance Quota Blocks Scale-Out
[VERIFY] Confirm quota, current consumption, pending instances, region, and account or project. [VERIFY] Confirm the DevOps workload requests the expected capacity and is otherwise healthy. [VERIFY] Review recent quota and scaling events. [STOP] Do not resize workloads merely to bypass an unverified quota condition. [VERIFY] After approval, confirm pending instances allocate and service health recovers.

## Load Balancer Health Probe Port Mismatch
[VERIFY] Compare configured probe port and path with the backend listening endpoint. [VERIFY] Inspect backend health and Linux service state for the same targets. [VERIFY] Compare the configuration with the last known-good load balancer revision. [STOP] Do not restart healthy backends when probes target the wrong port. [VERIFY] After approval, confirm probes succeed and all intended backends become healthy.

## Container Image Pull Failure
[VERIFY] Confirm the exact image registry, repository, tag, digest, and ImagePullBackOff event. [VERIFY] Verify registry authentication and that the referenced artifact exists. [VERIFY] Confirm CloudOps registry and network services are healthy. [STOP] Do not substitute an unapproved mutable tag. [VERIFY] After approval, confirm the rollout pulls the intended digest and becomes healthy.

## Kubernetes Readiness Endpoint Mismatch
[VERIFY] Compare the configured readiness path and port with the application endpoint contract. [VERIFY] Inspect probe events, ready replica count, and container logs. [VERIFY] Confirm Linux node health is not the limiting condition. [STOP] Do not disable readiness probes to force traffic. [VERIFY] After approval, confirm the endpoint returns success and replicas remain ready.

## Middleware Queue Consumer Stopped
[VERIFY] Measure active consumer count, queue depth, oldest-message age, and delivery or acknowledgement errors. [VERIFY] Confirm Linux host and database dependencies are healthy. [VERIFY] Compare consumer loss with deployment and configuration events. [STOP] Do not purge queued messages. [VERIFY] After approval, confirm a consumer remains active and queue depth drains without message loss.

## Expired Service Certificate
[VERIFY] Inspect certificate validity, subject alternative names, chain, trust store, and TLS handshake result. [VERIFY] Confirm Windows certificate services and the network path are healthy. [VERIFY] Compare certificate identity with the affected service endpoint and renewal record. [STOP] Do not bypass certificate validation. [VERIFY] After approved replacement, confirm the full chain and TLS handshake from an external client.

## Cross-Functional Checkout Failure
[VERIFY] Correlate Windows dependency-timeout events, DevOps release health, Network reachability, and Linux worker health for one time window. [VERIFY] Confirm the checkout route is reachable with no packet loss before eliminating Network. [VERIFY] Confirm host services and resource pressure are healthy before eliminating Windows and Linux. [VERIFY] Compare the latest release dependency state with the last successful checkout. [STOP] Do not remediate until all four teams acknowledge their evidence. [VERIFY] After approval, repeat all four checks and confirm checkout success.
