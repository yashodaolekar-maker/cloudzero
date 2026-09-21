"""Core-domain drafting prompts. These are exercises, not reviewed training answers."""
import json

TOPICS = {
    'NETWORK': ['DNS resolution failure', 'VLAN mismatch', 'routing asymmetry', 'wireless roaming interruption', 'SSID visible but client association fails', 'SSID association succeeds but 802.1X authentication fails', 'wireless client authenticates but DHCP fails', 'wireless client receives DHCP but cannot reach the application', 'packet loss after an MTU change', 'Cisco-HPE-Juniper route or forwarding discrepancy', 'STP loop or topology change', 'BGP or OSPF adjacency failure'],
    'WINDOWS': ['domain logon failure', 'DNS service stopped after patching', 'Group Policy not applied', 'service account permission regression', 'disk pressure affecting a Windows service'],
    'DEVOPS': ['deployment readiness failure', 'container image pull failure', 'pipeline credential failure', 'configuration drift after release', 'rollback and recovery verification'],
    'CLOUDOPS': ['unhealthy load balancer targets', 'cloud route misconfiguration', 'IAM access denial', 'unexpected resource cost increase', 'capacity exhaustion and autoscaling'],
    'SECURITY': ['suspicious authentication activity', 'endpoint alert triage', 'firewall policy change investigation', 'vulnerability prioritization with asset context', 'containment proposal and evidence preservation'],
    'LINUX': ['service failure after deployment', 'filesystem or inode exhaustion', 'DNS or route failure on a host', 'CPU or memory pressure', 'TLS certificate or time drift failure'],
    'DATABASE': ['connection pool exhaustion', 'blocking lock or wait', 'query latency regression', 'replication lag or failover signal', 'storage or transaction-log pressure'],
    'MIDDLEWARE': ['consumer lag', 'message retry storm', 'API gateway timeout', 'schema incompatibility', 'dead-letter or poison-message handling'],
}

CHECKS = {
    'NETWORK': ['Compare the configured resolver, query results and reachability from affected and unaffected clients.', 'Compare the assigned access VLAN, expected segment and uplink configuration.', 'Compare forward and return paths and relevant routing tables for the affected endpoints.', 'Collect timestamped client and access-point observations across the handoff, including session continuity.', 'Correlate client/AP association reason codes, RF metrics, policy rejection, and an unaffected client at the same location.', 'Correlate EAP/RADIUS events, certificate and clock state, AAA reachability, authorization result, and controller/AP client events.', 'Correlate DHCP Discover/Offer/Request/Ack by transaction ID with WLAN role, VLAN, relay, trunk, gateway, and scope state.', 'Validate address, ARP/ND, gateway, role/ACL, DNS, firewall decision, return path, and the actual application transaction.', 'Compare interface MTUs, packet-size-dependent failures and path observations before and after the change.', 'Identify vendor, model and release, then compare route, RIB/FIB, neighbor, policy and forwarding evidence using approved platform syntax.', 'Compare root bridge, port roles, topology-change events, loops and the last known-good topology.', 'Compare neighbor state, timers, authentication, transport reachability and received/advertised prefixes.'],
    'WINDOWS': ['Correlate authentication failures with domain controller reachability, name resolution and time synchronization.', 'Inspect service state, startup configuration and timestamped service errors around the maintenance window.', 'Compare effective policy, scope and processing errors on affected and unaffected hosts.', 'Identify the service identity and compare effective permissions and recent policy changes with the last working state.', 'Inspect volume capacity, growth sources and service errors before proposing a reviewed cleanup.'],
    'DEVOPS': ['Inspect readiness failures, startup logs and differences from the last healthy deployment.', 'Inspect image references, registry reachability, pull errors and credential scope without exposing credentials.', 'Inspect the failed pipeline stage, credential expiry and permission scope, redacting secret values.', 'Compare deployed configuration and artifact versions against the approved release and last healthy revision.', 'Confirm a known-good artifact, data compatibility, approval and rollback criteria before proposing a rollback.'],
    'CLOUDOPS': ['Compare target health-check reasons, application readiness and network paths for healthy and unhealthy targets.', 'Compare effective routes, next-hop reachability and recent changes for the affected subnet.', 'Identify the requesting principal, denied operation, resource and effective policy before proposing least-privilege changes.', 'Break down the cost increase by service, resource and time window, then correlate usage and configuration changes.', 'Compare demand, resource saturation, scaling events, policy limits and quota failures.'],
    'SECURITY': ['Correlate authentication logs, account context and known administrative activity before declaring compromise.', 'Collect the alert evidence, endpoint timeline and related activity while preserving original evidence.', 'Compare the approved change with effective policy, traffic observations and the affected asset scope.', 'Validate the finding against asset version, exposure, business impact and available compensating controls.', 'Define the affected scope, evidence-preservation needs, proposed containment and operational impact for approval.'],
    'LINUX': ['Inspect service state, dependency failures, logs, deployment changes and a known-good host.', 'Inspect filesystem blocks, inodes, growth sources and service errors without deleting data.', 'Compare interface, route, resolver, firewall and TLS/time evidence with an unaffected host.', 'Correlate process saturation, memory pressure, I/O wait, limits and workload change over the incident window.', 'Inspect certificate chain, expiry, trust store, hostname, clock and recent secret/configuration changes.'],
    'DATABASE': ['Inspect pool limits, active sessions, authentication errors and database connection saturation.', 'Identify blockers, waiters, transaction age and lock evidence without killing sessions.', 'Compare query plans, duration, reads, waits, indexes and deployment/schema changes against the last healthy window.', 'Inspect primary/replica state, replay/flush/apply lag, network health and failover events.', 'Inspect storage, transaction-log/WAL growth, checkpoint pressure and retention before proposing cleanup.'],
    'MIDDLEWARE': ['Compare producer rate, consumer rate, lag, partition assignment and downstream latency.', 'Correlate retries, backoff, duplicate risk, dead letters, error class and the triggering deployment.', 'Trace the transaction across gateway, upstream, network, timeout policy and downstream service.', 'Compare schema versions, compatibility rules, serializer errors and rollout state.', 'Inspect message headers, poison-message patterns, idempotency and quarantine options before replay or purge.'],
}


def drafts():
    for domain, topics in TOPICS.items():
        for index, topic in enumerate(topics):
            yield {
                'trainingReady': False,
                'exclusion': 'Draft exercise: supply evidence and a human-reviewed answer before inclusion.',
                'messages': [
                    {'role': 'system', 'content': f'You are the {domain} engineering twin. Separate symptoms from verified evidence. Explain uncertainty, read-only checks, team handoffs and recovery verification. Never claim an action occurred without evidence. Return JSON with an answer string.'},
                    {'role': 'user', 'content': f'Investigate {topic}. No diagnostic evidence is supplied yet. What evidence would you request before proposing a change?'},
                    {'role': 'assistant', 'content': json.dumps({'answer':
                        'The reported symptom alone does not establish a root cause. ' + CHECKS[domain][index] +
                        ' Request the missing observations and record their timestamps. Coordinate with the owner of any implicated dependency. '
                        'No change has been executed or recovery verified; any proposed change needs its applicable approval, rollback plan and fresh service checks.'})},
                ],
                'provenance': {'domain': domain, 'incidentId': f'DRAFT-{domain}-{index + 1}',
                               'incidentFamily': f'{domain}:{topic}', 'mode': 'SIMULATION',
                               'source': 'DRAFT_CURRICULUM', 'reviewerId': '', 'reviewEventId': ''},
                'reviewChecklist': ['Technical correctness', 'No invented observations', 'Useful next check',
                                    'Approval and rollback where applicable', 'Verification and escalation',
                                    'Remove secrets and personal data'],
            }


def write_drafts(path):
    with path.open('x', encoding='utf-8') as output:
        for row in drafts():
            output.write(json.dumps(row, ensure_ascii=False) + '\n')
