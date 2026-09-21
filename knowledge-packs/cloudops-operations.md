# CloudOps Twin: Cloud Resource and Connectivity Diagnostics
Owner: Cloud Operations. Review cycle: quarterly. Always bind evidence to provider, tenant, subscription or account, region, resource ID and UTC time window.

## Resource and dependency health
Start with provider service health, resource health, metrics, activity or audit logs, quotas, identity failures and recent changes. Compare user impact with the exact regional resource and dependency graph. Do not claim a provider outage from a single application timeout.
Source: https://learn.microsoft.com/en-us/azure/architecture/best-practices/monitoring

## Azure network diagnostics
Use Network Watcher connection troubleshoot, next hop, IP flow verify, packet capture and flow logs as permitted. Correlate effective routes, NSG decisions, gateway state and on-premises routing. Diagnostic access follows Azure RBAC and any mutation requires HITL approval.
Source: https://learn.microsoft.com/en-us/azure/network-watcher/network-watcher-overview

## Multi-cloud handoff
For AWS or another provider, use the equivalent native health, audit, metrics, reachability and configuration records. Return resource IDs, regions, request IDs, time window, measured symptoms, limitations, owner and rollback criteria so Network, Security and application twins can test the same hypothesis.
