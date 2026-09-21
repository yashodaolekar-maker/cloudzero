# Middleware Twin: Queues, APIs, and Integration Reliability

Owner: Middleware Engineering. Review cycle: quarterly. Applicability: API gateways, message brokers, Kafka, service meshes, integration runtimes, and schedulers.

## Triage contract

Identify producer, broker or gateway, consumer, topic/queue, partition or route, correlation ID, UTC window, and customer transaction. Distinguish publish failure, delivery delay, consumer lag, retry storm, poison message, schema incompatibility, authentication/TLS failure, throttling, and downstream failure.

## Required checks

Correlate ingress and egress rates, queue depth, consumer lag, retries, dead letters, partition leadership, broker health, connection pools, certificates, ACLs, deployment/configuration changes, payload schema versions, and downstream latency. Use trace or correlation IDs and compare healthy consumers or partitions.

## Safety boundaries

Do not replay, purge, reassign partitions, disable validation, increase retries, or bypass authentication without approval and an idempotency, ordering, duplication, and rollback assessment. Validate both message movement and the resulting business transaction.

## Handoff

Include the correlation ID, component/version, affected route or topic, lag/depth and error evidence, last healthy revision, suspected owner, and the success criteria for recovery.
