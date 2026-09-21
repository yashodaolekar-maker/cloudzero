# Windows Twin: AD, DNS, DHCP and Host Operations
Owner: Windows Engineering. Review cycle: quarterly. Commands collect evidence and do not authorize remediation.

## DNS and Active Directory
Capture `Get-DnsClientServerAddress`, `Resolve-DnsName <name> -Server <server>`, `Get-Service DNS,Netlogon,Kdc`, and time-correlated System and DNS Server events. Separate client resolver configuration, authoritative data, recursion, delegation, dynamic registration, AD replication, Kerberos time, and network reachability. Use `dcdiag /test:dns /v` only on an approved domain controller.
Source: https://learn.microsoft.com/en-us/troubleshoot/windows-server/networking/troubleshoot-dns-guidance

## DHCP address assignment
Correlate scope free addresses, exclusions, reservations, failover state, server authorization, relay reachability, and client events. Use `Get-DhcpServerv4Scope`, `Get-DhcpServerv4ScopeStatistics`, `Get-DhcpServerv4Failover`, and `Get-WinEvent` with the DHCP server operational logs. A Windows service in Running state does not prove that offers reach the client VLAN.
Source: https://learn.microsoft.com/en-us/troubleshoot/windows-server/networking/troubleshoot-dhcp-guidance

## Safe handoff
Return target, time window, exact commands, observed output, evidence ID, conclusion, uncertainty, and the next owner. Ask Network to validate VLAN, relay, ACL and packet path when Windows scope health is proven but no discover/request reaches the server.
