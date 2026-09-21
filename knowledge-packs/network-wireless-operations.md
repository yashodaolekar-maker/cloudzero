# Network Twin: Enterprise Wireless Incident Diagnostics

Owner: Network Engineering. Review cycle: quarterly and after wireless controller, AP, identity, RF, or campus changes. This runbook trains the existing Network Twin. It does not authorize configuration changes. Confirm vendor, controller platform, AP model, software release, authentication method, and management plane before using commands.

## Senior CCIE operating model

Treat “SSID does not connect” as a transaction, not a diagnosis. A successful wireless connection is a sequence:

`client discovery/probe -> beacon and association -> 802.1X or PSK authentication -> key installation -> DHCP -> ARP/ND and default gateway -> DNS -> application transaction`

The agent must identify the first failed event in that sequence. “SSID is visible,” “AP is up,” or “controller is reachable” does not prove that the client can authenticate or obtain service.

## Event-driven evidence contract

Start a single UTC incident window: normally five minutes before the first failure through ten minutes after the latest reproduction. Capture the client MAC, anonymized username or device identity, SSID, AP name and radio, controller or cloud tenant, site/building/floor, VLAN or segment, authentication method, client OS, exact failure time, and one known-good client if available.

Correlate events by client MAC, username/device identity, AP, session ID, and timestamp. Preserve raw event IDs and source systems. Collect from the client, AP/radio, wireless controller or cloud, AAA/RADIUS/identity, DHCP, switching path, firewall, DNS, and the target application. Do not infer the cause from a single client-facing message.

## Decision tree: locate the first failed event

### 1. SSID not visible

Validate whether the SSID is advertised at the affected location and band. Compare an affected and unaffected AP, radio, regulatory domain, RF profile, WLAN-to-AP policy, AP operational state, flex/local switching mode, and recent controller/template changes. Check whether the SSID is hidden, disabled, scheduled, restricted by location, or absent because the AP is in a different policy group.

If only 5 GHz or 6 GHz clients fail, check band capability, channel width, DFS/CAC state, power, client driver support, PSC behavior for 6 GHz, and security requirements such as WPA3/PMF. If all SSIDs are absent, treat AP power, CAPWAP/control, PoE, switchport, or RF failure as higher probability.

### 2. SSID visible but association fails

Correlate client association and disassociation reason codes, AP radio events, retry rate, RSSI, SNR, noise floor, channel utilization, airtime, channel changes, band steering, minimum data rate, load balancing, and maximum-client limits. Check whether the client is rejected by policy, has incompatible capabilities, or is repeatedly roaming between APs.

Validate the client is not merely out of RF range. Compare the same client near the AP and compare another client at the same location. A low RSSI, low SNR, excessive retries, high noise, or overloaded channel requires RF evidence rather than an authentication change.

### 3. Association succeeds but authentication fails

For WPA2/WPA3-Enterprise, correlate the wireless authentication event with RADIUS Access-Request, Access-Accept/Reject, timeout, server selection, NAS/client address, shared-secret or Message-Authenticator errors, certificate validation, EAP method, identity-store result, authorization profile, VLAN/role assignment, and controller clock. Validate reachability and return path from the controller or AP to the correct AAA server.

For PSK or PPSK, validate the selected WLAN security policy, key format, identity-to-key mapping, key rotation, client capability, PMF requirement, and authentication failure reason. Never request or expose the secret.

If RADIUS shows no request, investigate the wireless policy, controller/AP forwarding path, AAA server selection, and transport reachability. If RADIUS rejects, investigate identity, certificate, policy, group, posture, and authorization evidence. If RADIUS accepts but the client fails, investigate EAP completion, key negotiation, PMF, clock, driver, and controller/AP compatibility.

### 4. Authentication succeeds but DHCP fails

Confirm the assigned WLAN role, VLAN/segment, local versus central switching, tunnel status, AP switchport trunk/native VLAN, allowed VLANs, SVI/gateway state, DHCP relay/helper, scope availability, exclusions, reservations, failover state, and DHCP server authorization. Correlate DHCP Discover/Offer/Request/Ack events by client MAC and transaction ID.

Interpret the event sequence precisely: no Discover at the server suggests a path, relay, VLAN, or local-switching problem; Discover with no Offer suggests DHCP scope, policy, relay, or server response; Offer without Request suggests client or path behavior; Request without Ack suggests relay, scope, authorization, or policy inconsistency. A Running DHCP service alone is not proof that the wireless client can receive an address.

### 5. DHCP succeeds but network access fails

Validate client address, mask/prefix, gateway, ARP/ND, default route, role/ACL, downloadable ACL, firewall policy, captive portal or posture state, DNS server assignment, and split-tunnel or fabric policy. Test the gateway first, then an approved internal endpoint, DNS, and the customer application. Compare forward and return paths and identify whether traffic is centrally switched, locally switched, tunneled, or subject to a security service.

If the client reaches the gateway but not the application, hand off with exact source IP, destination, protocol/port, role/ACL, firewall decision, DNS result, and timestamps. Do not label this a wireless association problem.

## Vendor-neutral command and telemetry families

Use the platform equivalent of: client detail and event history; AP join and radio state; WLAN/SSID policy; RF statistics and channel history; controller mobility or tunnel state; AAA/RADIUS live logs; DHCP lease and packet events; switch MAC/VLAN/trunk state; gateway ARP/ND and route; ACL/firewall decision logs; and packet capture where approved. Record target, command or query, release, UTC timestamp, and evidence ID.

## Cisco wireless translation guide

For Catalyst wireless, use the approved release-specific equivalents of client detail and event history, AP join and radio status, WLAN policy, RF and channel statistics, mobility or fabric state, and AAA/RADIUS logs. Older AireOS and Catalyst 9800 syntax and event names differ; identify the controller family and release first. Correlate `show wireless client summary/detail`, client event history, AP and radio operational state, WLAN policy, mobility/control status, and controller AAA statistics only when those commands match the installed release. Do not use a command failure as evidence that the underlying feature is absent.

## Aruba/HPE wireless translation guide

For Aruba Mobility Controllers, Aruba Central, and Instant, use the approved release-specific equivalents of client troubleshooting, AP/radio state, WLAN profile, authentication/AAA logs, role assignment, datapath/tunnel state, and DHCP visibility. Controller-managed, Central-managed, and Instant deployments expose different event locations and terminology. Identify the management plane before directing collection. Correlate client failure reason, role/VLAN assignment, AAA result, AP radio health, tunnel or local-bridge path, and DHCP evidence.

## Juniper Mist and other platforms

Use the platform’s client timeline, AP health, WLAN policy, assurance events, authentication/AAA, RF, DHCP, and path telemetry. For Mist or cloud-managed platforms, preserve the site, AP, client, event timeline, and cloud-generated failure category. For Ruckus, Extreme, Meraki, Huawei, or another platform, retrieve the reviewed vendor runbook before giving syntax. Keep the same event sequence and evidence contract.

## Root-cause confidence rules

Promote a root cause only when the first failed event is supported by at least two independent signals or one authoritative transaction record plus a confirming comparison. Examples: RADIUS Reject plus matching identity-policy reason; DHCP Discover observed with no Offer plus exhausted scope; association rejects plus matching AP/controller reason and reproducible client comparison; gateway reachable but firewall deny matches the failed application flow.

Use “unconfirmed” when timestamps do not align, identity is ambiguous, telemetry is missing, or the failure reproduces only on one uninstrumented client. State the next event or packet capture needed to discriminate hypotheses.

## Safe remediation and recovery validation

Configuration changes to WLAN security, RF profiles, channels, power, AAA, VLANs, DHCP relay, ACLs, controller policy, or AP templates require approval, change ID, blast-radius assessment, and rollback. After an approved change, validate the complete sequence from discovery or association through authentication, DHCP, gateway, DNS, and the affected application on both a test client and a representative user client. Observe for recurrence across the defined window and confirm that unaffected SSIDs and sites remain healthy.

## Escalation

Escalate to RF engineering for noise, interference, capacity, channel, or roaming evidence; Identity/AAA for EAP, certificate, RADIUS, or authorization evidence; Windows/DHCP for scope, relay, or lease evidence; Network switching for VLAN, trunk, STP, gateway, or path evidence; Security for ACL, firewall, posture, or captive-portal evidence; and the wireless vendor when event evidence conflicts with forwarding or controller behavior. Include the full event timeline and exact missing discriminator.
