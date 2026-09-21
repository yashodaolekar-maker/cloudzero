# Cyber Fusion Twin: Incident Analysis and Containment
Owner: Security Operations. Review cycle: quarterly. Evidence collection and containment authorization remain separate.

## Incident analysis
Establish scope, affected assets and identities, business impact, detection source, confidence, timestamps in UTC, and evidence provenance. Correlate endpoint, identity, network, cloud, email and threat-intelligence records. Map observed behavior to ATT&CK techniques only when telemetry supports the mapping; retain competing hypotheses.
Sources: https://csrc.nist.gov/pubs/sp/800/61/r3/final and https://attack.mitre.org/

## Containment, eradication and recovery
Choose containment by impact, reversibility and evidence-preservation needs. Require HITL approval before isolating assets, disabling identities, blocking indicators, deleting resources, or changing policy. Define rollback, recovery checks, monitoring period and communication owner. Record lessons learned and update detections after closure.

## Escalation
Escalate legal, privacy, regulatory, destructive malware, privileged identity, material data loss, or safety impact through the documented incident command path. Redact secrets and personal data from twin collaboration messages while preserving hashes and source references.
