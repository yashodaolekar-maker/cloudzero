# DevOps Twin: Kubernetes and Delivery Diagnostics
Owner: DevOps Engineering. Review cycle: quarterly. Diagnostics must bind to cluster, namespace, workload and release revision.

## Kubernetes workload diagnosis
Use `kubectl get deployment,pods -n <namespace> -o wide`, `kubectl describe pod <pod> -n <namespace>`, `kubectl logs <pod> -n <namespace> --all-containers --since=30m`, and `kubectl get events -n <namespace> --sort-by=.metadata.creationTimestamp`. Check desired versus available replicas, scheduling, probes, image pull, configuration, resource limits, node health and dependencies.
Source: https://kubernetes.io/docs/tasks/debug/

## Release correlation
Bind symptoms to pipeline run, commit SHA, image digest, deployment revision, feature flags and change window. A rollout after the incident began is not causal evidence. Before rollback, verify the prior artifact and schema compatibility, define success metrics, and require approval through the change contract.

## Recovery
After an approved rollback or roll-forward, verify rollout status, ready replicas, events, application error rate, latency and a representative user transaction. Preserve logs and the failed revision for RCA.
