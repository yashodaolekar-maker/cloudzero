# Engineer investigation curriculum

These are synthetic exercises and runtime investigation procedures, not trained model weights or proof of accuracy. Human review is required before any example enters the reviewed training export.

## Common working method

1. Read the incident, affected CI, impact, priority and maintenance window. Do not infer cause from timing.

2. Confirm which team owns the affected dependency. Ask peers for exact incident-bound observations.

3. Run an allowlisted read-only diagnostic; record the evidence ID and revision. State missing information explicitly.

4. Explain what was checked, what was found, what remains blocked and who owns the next action.

5. Seek the required approval before any change. The demo repair updates only sandbox rows.

6. Collect fresh evidence after repair. Review actual user journey outcomes separately from technical recovery.

7. Record an explicit reviewer decision, correction and experience feedback; do not self-certify correctness.

## NETWORK

- **Windows DNS did not restart after patching**: check interfaces and DNS reachability. Repair owner: WINDOWS.

- **Orders delayed by a saturated database pool**: check interface status, packet loss and application reachability. Repair owner: DATABASE.

- **Users cannot reach an application after a VLAN change**: check access VLAN against the assigned application segment. Repair owner: NETWORK.

- **Wireless clients lose their session while roaming**: check AP handoff interruption and session continuity. Repair owner: NETWORK.

- **Large application requests fail across a tunnel**: check path MTU and large-packet delivery. Repair owner: NETWORK.

- **Kerberos sign-in fails because of host clock drift**: check interface status, packet loss and application reachability. Repair owner: WINDOWS.

- **Read replica is behind the primary**: check interface status, packet loss and application reachability. Repair owner: DATABASE.

- **A systemd service fails after a configuration change**: check interface status, packet loss and application reachability. Repair owner: LINUX.

- **A cloud subnet route sends traffic to the wrong next hop**: check interface status, packet loss and application reachability. Repair owner: CLOUDOPS.

- **An expired service certificate blocks TLS access**: check interface status, packet loss and application reachability. Repair owner: SECURITY.

## WINDOWS

- **Windows DNS did not restart after patching**: check DNS service state after maintenance. Repair owner: WINDOWS.

- **Users cannot reach an application after a VLAN change**: check host service state and operating system errors. Repair owner: NETWORK.

- **Wireless clients lose their session while roaming**: check authentication service availability. Repair owner: NETWORK.

- **Kerberos sign-in fails because of host clock drift**: check clock offset and Kerberos result. Repair owner: WINDOWS.

- **IIS application pool remains stopped after deployment**: check IIS application pool and HTTP response. Repair owner: WINDOWS.

- **An expired service certificate blocks TLS access**: check host service state and operating system errors. Repair owner: SECURITY.

## DATABASE

- **Orders delayed by a saturated database pool**: check active connections, waiters and query latency. Repair owner: DATABASE.

- **A long transaction blocks order processing**: check blocking transaction and query wait duration. Repair owner: DATABASE.

- **Read replica is behind the primary**: check replication delay and replay state. Repair owner: DATABASE.

- **Database writes fail because the log volume is full**: check write availability and log volume utilization. Repair owner: DATABASE.

- **Application cannot read a mounted data directory**: check host service state and operating system errors. Repair owner: LINUX.

- **Messages accumulate because a queue consumer is stopped**: check host service state and operating system errors. Repair owner: MIDDLEWARE.

## LINUX

- **Orders delayed by a saturated database pool**: check host service state and operating system errors. Repair owner: DATABASE.

- **Large application requests fail across a tunnel**: check host service state and operating system errors. Repair owner: NETWORK.

- **A long transaction blocks order processing**: check host service state and operating system errors. Repair owner: DATABASE.

- **Database writes fail because the log volume is full**: check filesystem mount state. Repair owner: DATABASE.

- **Application logs fill the Linux root filesystem**: check filesystem utilization and log rotation. Repair owner: LINUX.

- **A systemd service fails after a configuration change**: check systemd service state and configuration validation. Repair owner: LINUX.

- **Application cannot read a mounted data directory**: check application identity and directory access. Repair owner: LINUX.

- **Load balancer health checks target the wrong port**: check host service state and operating system errors. Repair owner: CLOUDOPS.

- **A release uses the wrong readiness endpoint**: check host service state and operating system errors. Repair owner: DEVOPS.

- **Messages accumulate because a queue consumer is stopped**: check host service state and operating system errors. Repair owner: MIDDLEWARE.

## DEVOPS

- **IIS application pool remains stopped after deployment**: check host service state and operating system errors. Repair owner: WINDOWS.

- **Application logs fill the Linux root filesystem**: check host service state and operating system errors. Repair owner: LINUX.

- **Cloud scale-out is blocked by an instance quota**: check host service state and operating system errors. Repair owner: CLOUDOPS.

- **Release rollout fails to pull a container image**: check release image reference and rollout status. Repair owner: DEVOPS.

- **A release uses the wrong readiness endpoint**: check readiness path and deployment health. Repair owner: DEVOPS.

## CLOUDOPS

- **A cloud subnet route sends traffic to the wrong next hop**: check subnet route and next-hop reachability. Repair owner: CLOUDOPS.

- **Cloud scale-out is blocked by an instance quota**: check instance quota and pending capacity requests. Repair owner: CLOUDOPS.

- **Load balancer health checks target the wrong port**: check load balancer probe port and backend health. Repair owner: CLOUDOPS.

- **Release rollout fails to pull a container image**: check host service state and operating system errors. Repair owner: DEVOPS.

## MIDDLEWARE

- **Messages accumulate because a queue consumer is stopped**: check consumer count, queue depth and delivery. Repair owner: MIDDLEWARE.

## SECURITY

- **An expired service certificate blocks TLS access**: check certificate validity and TLS handshake. Repair owner: SECURITY.

## Additional operational roles

SRE coordinates priority, incident ownership, evidence completeness and escalation. The communications twin publishes the recorded blocker, owner, impact and next update; it must not invent completion or user satisfaction.

## Extending the real incident bucket

Map anonymized historical tickets to the closest exercise, add reviewed domain runbooks, and use the existing human-review training export. Hold out incident groups for evaluation before QLoRA training. Compare correct ownership, grounded observations, justified escalation, recovery verification, SLA performance and actual journey XLA. The 20 exercises do not cover every possible production issue.
