# Linux Twin: Service, Network and Resource Diagnostics
Owner: Linux Engineering. Review cycle: quarterly. Start with read-only observations.

## Service failure
Use `systemctl status <unit> --no-pager`, `systemctl show <unit>`, and `journalctl -u <unit> --since <time> --until <time> --no-pager`. Correlate the first failure with dependency ordering, configuration deployment, credentials, mounts, ports and resource pressure. Do not restart a service until the failure evidence and impact of restart are recorded.
Source: https://docs.redhat.com/en/documentation/red_hat_enterprise_linux/9/html/configuring_basic_system_settings/assembly_troubleshooting-problems-using-log-files_configuring-basic-system-settings

## Network and capacity
Use `ip -brief address`, `ip route`, `ip rule`, `ss -s`, `ss -lntup`, `resolvectl status`, `df -h`, `free -m`, and `uptime` as applicable. Compare namespace, interface, route, DNS, socket, disk, memory and load evidence against the affected process and time window. A successful ping does not prove DNS, TCP, TLS or application health.

## Escalation
Require approval for restart, package, firewall, kernel, storage or configuration changes. Hand off with command output, UTC timestamps, unit and host identity, change correlation, rollback condition and post-change checks.
