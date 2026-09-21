# Database Twin: Core Reliability and Performance

Owner: Database Engineering. Review cycle: quarterly. Applicability: PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, and managed database services. Commands are diagnostic unless explicitly approved.

## Triage contract

Bind every observation to engine, cluster/instance, database, role, region, UTC window, and query or service name. Establish whether the symptom is connection failure, authentication, lock/wait, query regression, storage, replication, failover, capacity, or data correctness. Compare a healthy replica or prior known-good window.

## Required checks

Inspect connection saturation, pool behavior, authentication and TLS errors, active sessions, waits/locks, slow-query evidence, CPU, memory, I/O latency, storage headroom, replication lag, checkpoint or log pressure, failover events, schema/release changes, and backup/restore status. Redact query parameters and credentials.

## Safety boundaries

Never kill sessions, fail over, change parameters, rebuild indexes, alter schema, purge data, or restore backups without explicit approval, impact analysis, rollback or recovery plan, and owner confirmation. A database process being up does not prove application transactions succeed.

## Handoff

Return evidence IDs, engine/version, affected transactions, wait or error class, connection and resource measurements, suspected dependency, and the exact validation query or customer transaction required after remediation.
