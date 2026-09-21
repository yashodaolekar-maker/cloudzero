export interface KBArticle {
  id: string;
  keywords: string[];
  title: string;
  category: "Routing" | "Security" | "Wireless" | "Core Services";
  procedure: string;
}

export const KNOWLEDGE_BASE: KBArticle[] = [
  {
    id: "kb-intro",
    keywords: ["takeup", "take up", "introduce", "who are you", "yourself"],
    title: "Apex Twin Operational Takeup & Introduction",
    category: "Core Services",
    procedure: "Absolutely! Hey everyone, Apex Twin here, Senior Network Security Engineer. I am tuned into the call and ready to take up any hard-hitting questions regarding our cloud routing, enterprise wireless dropouts, or Palo Alto security configurations. Fire away!"
  },
  {
    id: "kb-dhcp",
    keywords: ["dhcp", "ip address", "helper", "helper-address", "lease", "allocation"],
    title: "DHCP IP Helper Configuration & Troubleshooting Across VLANs",
    category: "Core Services",
    procedure: "When DHCP requests cross VLAN boundaries: 1. Place an IP Helper address on the core Layer 3 switch or router interface. Use the command sequence 'interface Vlan10', then 'ip helper-address 10.1.100.5' (pointing to the central DHCP server). 2. Ensure UDP ports 67 and 68 are permitted through perimeter firewalls and routers."
  },
  {
    id: "kb-dns",
    keywords: ["dns", "name resolution", "nslookup", "dig", "domain", "fqdn"],
    title: "Enterprise DNS Resolution Troubleshooting Procedure",
    category: "Core Services",
    procedure: "To troubleshoot Enterprise DNS name resolution issues: 1. Perform an 'nslookup' or 'dig' to verify query responses from the active server. 2. Verify DNS forwarders configuration on internal Active Directory servers. 3. Check UDP/TCP port 53 on intervening firewalls. 4. Flush client cache with 'ipconfig /flushdns' and re-test."
  },
  {
    id: "kb-cisco-asa",
    keywords: ["asa", "cisco asa", "adaptive security", "pix", "firepower"],
    title: "Cisco ASA Firewall Stateful Inspection & Perimeter Setup",
    category: "Security",
    procedure: "Cisco ASA, or Adaptive Security Appliance, is an enterprise network security platform combining stateful packet inspection, remote-access services, and routing services. We typically configure access control lists, static NAT policies, and secure encrypted tunnels on the ASA to safely manage traffic boundaries at the corporate perimeter."
  },
  {
    id: "kb-cisco-asa-acl",
    keywords: ["asa acl", "cisco acl", "access-list", "access-group", "asa permit"],
    title: "Configuring Access Control Lists (ACLs) on Cisco ASA",
    category: "Security",
    procedure: "To configure an Access Control List on Cisco ASA: 1. Create the ACL statement: 'access-list OUTSIDE_IN extended permit tcp any host 192.168.1.50 eq 443'. 2. Bind the ACL to the outside interface: 'access-group OUTSIDE_IN in interface outside'. 3. Verify active ACL hits using 'show access-list OUTSIDE_IN'."
  },
  {
    id: "kb-wifi-drops",
    keywords: ["wi-fi", "wifi", "drops", "wireless", "catalyst", "9800", "wlc", "client"],
    title: "Mitigating Corporate Wireless Client Drops (Catalyst 9800 WLC)",
    category: "Wireless",
    procedure: "To troubleshoot corporate wireless drops on Cisco Catalyst 9800 WLC: 1. Check for 2.4 Giga-hertz RF congestion and optimize RRM channel assignments. 2. Verify Session Timeout and Session Key Rotation values under WLAN security settings. 3. Look for 802.1X EAP timeouts in radius server logs. 4. Adjust clean-air mitigation to auto-avoid active interference."
  },
  {
    id: "kb-stp-loop",
    keywords: ["stp", "spanning-tree", "loop", "storm", "broadcast", "bpdu", "portfast"],
    title: "Mitigating Spanning-Tree Loop Storms in Switch Stacks",
    category: "Routing",
    procedure: "To mitigate an active Spanning-Tree loop storm: 1. Locate the interface with the highest rate of broadcast packet increments using 'show interfaces | include drops|input rate'. 2. Apply BPDU Guard and PortFast on edge access ports via 'spanning-tree portfast' and 'spanning-tree bpduguard enable'. 3. Enforce root placement on your primary core switch via 'spanning-tree vlan <ids> root primary'."
  },
  {
    id: "kb-palo-alto",
    keywords: ["palo alto", "paloalto", "app-id", "session drops", "port shifting", "pan-os"],
    title: "Troubleshooting Active Session Drops on Palo Alto Firewalls",
    category: "Security",
    procedure: "To resolve Palo Alto Networks session drops or port-shifting issues: 1. Verify App-ID signature updates aren't misclassifying persistent TCP streams. 2. Check the session table for aging timeouts using 'show session all filter state discard'. 3. If asymmetric routing is occurring across HA clusters, enable 'Asymmetric Path Bypass' or configure active path monitoring sync."
  },
  {
    id: "kb-aws-dx",
    keywords: ["aws", "transit gateway", "tgw", "direct connect", "redundant dx", "vgw"],
    title: "AWS Transit Gateway & Redundant Direct Connect Setup",
    category: "Routing",
    procedure: "For redundant AWS Direct Connect (DX) routing: 1. Build a primary and backup DX attachment terminating on different AWS Direct Connect Locations (DXLs). 2. Associate both DX Virtual Interfaces (VIFs) to a central Direct Connect Gateway (DXGW). 3. Connect DXGW to AWS Transit Gateway (TGW). 4. Use BGP AS-Path prepending to direct inbound AWS traffic towards your primary on-premise routers."
  },
  {
    id: "kb-azure-er",
    keywords: ["azure", "expressroute", "vnet peering", "hub", "azure firewall", "peering latency"],
    title: "Troubleshooting Peering Latency & Routing via Azure Firewall Hub",
    category: "Routing",
    procedure: "To optimize route redirection via Azure Firewall: 1. Build a hub-and-spoke virtual network layout. 2. Implement a User-Defined Route (UDR) on spoke subnets with route '0.0.0.0/0' pointing to the virtual appliance private IP of the central Azure Firewall. 3. Disable ExpressRoute gateway route propagation on spokes if traffic must inspect locally in the hub. 4. Verify ExpressRoute circuit ARP tables."
  },
  {
    id: "kb-gcp-interconnect",
    keywords: ["gcp", "interconnect", "cloud router", "shared vpc", "multi-chassis"],
    title: "GCP Multi-Chassis Dedicated Interconnect & Shared VPC Configuration",
    category: "Routing",
    procedure: "In GCP Enterprise architectures: 1. Establish Multi-Chassis Dedicated Interconnect by deploying redundant VLAN attachments across separate Edge Availability Domains. 2. Configure GCP Cloud Router with eBGP, enabling graceful restart. 3. In the Host Project, configure a Shared VPC and allocate host subnet permissions to Service Projects. 4. Use custom dynamic routing in the VPC to sync all global regions."
  },
  {
    id: "kb-globalprotect",
    keywords: ["globalprotect", "remote access drops", "ssl transport", "encrypted tunnel", "gp portal"],
    title: "Resolving GlobalProtect Active Connection Drops",
    category: "Security",
    procedure: "When GlobalProtect remote-access clients drop connections: 1. Check whether UDP/4500 encrypted transport is failing, forcing an SSL fallback over TCP/443 (causing TCP-in-TCP delays). 2. Verify client keepalive settings in the GP Gateway configuration. 3. Check for external firewall rate-limits on ESP packets. 4. Inspect Palo Alto system logs for SSL handshake failure details."
  },
  {
    id: "kb-bgp-aspath",
    keywords: ["bgp", "as-path", "prepending", "steer", "dual-homed", "local-preference"],
    title: "Steering Dual-Homed WAN Uplinks with BGP AS-Path Prepending",
    category: "Routing",
    procedure: "To steer inbound WAN traffic on dual-homed networks: 1. On your backup WAN router, configure an outbound BGP route-map that appends your local AS-Number multiple times: 'route-map PREPEND_OUT permit 10', then 'set as-path prepend <your-as> <your-as> <your-as>'. 2. Apply this route-map to the backup ISP BGP neighbor. 3. Use 'local-preference 200' on the primary router to prefer primary outbound paths."
  },
  {
    id: "kb-ethical-hacking-kerberoast",
    keywords: ["ethical hacking", "hacking", "kerberoasting", "active directory", "bloodhound", "privilege escalation", "exploitation", "kerberos", "ticket"],
    title: "Ethical Hacking: Active Directory Kerberoasting & Privilege Escalation Triage",
    category: "Security",
    procedure: "Kerberoasting is an active directory post-exploitation technique targeting service accounts. 1. Enumerate accounts with ServicePrincipalNames (SPNs) using PowerView: 'Get-DomainUser -SPN'. 2. Request a Ticket Granting Service (TGS) ticket using PowerShell: 'Request-SPNTicket'. 3. Export the ticket from LSASS memory using Mimikatz or Rubeus. 4. Crack the ticket offline using Hashcat: 'hashcat -m 13100 tickets.txt wordlist.txt'. To defend, implement strong AES256-encrypted passwords for service accounts and deploy active Honeywell honeypot accounts."
  },
  {
    id: "kb-ethical-hacking-ssrf",
    keywords: ["ssrf", "server side request forgery", "owasp", "web pen testing", "metadata api", "vulnerability"],
    title: "Ethical Hacking: Server-Side Request Forgery (SSRF) Exploitation & Defense",
    category: "Security",
    procedure: "Server-Side Request Forgery (SSRF) allows an attacker to force a server-side application to make HTTP requests to arbitrary domains. 1. Identify input fields or parameters that fetch remote assets or URLs. 2. Attempt to point the request to internal interfaces, e.g., 'http://127.0.0.1:80/' or cloud metadata services like 'http://169.254.169.254/latest/meta-data/'. 3. To mitigate, enforce a strict whitelist of destination domains, resolve hostnames before connection, and disable unused URL schemes (like gopher:// or file://)."
  },
  {
    id: "kb-darkweb-tor",
    keywords: ["darkweb", "dark web", "tor", "onion", "traffic analysis", "opsec", "hidden services"],
    title: "Dark Web: Tor Onion Routing Protocols & Hidden Service Investigations",
    category: "Security",
    procedure: "Tor (The Onion Router) secures anonymity via layered cryptographic hops (Entry/Guard, Middle, and Exit relays). 1. Hidden Services (.onion sites) establish connection points via 'Directory Servers' without revealing physical server IPs. 2. For forensic investigations: analyze browser artifacts, RAM image footprints for Tor processes, or correlate temporal netflow patterns. 3. Practice extreme OPSEC: route connections through virtualized secure hypervisors (like Whonix/Tails), block system JavaScript, and isolate host hardware signatures."
  },
  {
    id: "kb-darkweb-monitoring",
    keywords: ["credential leaks", "darknet markets", "leak monitoring", "compromised accounts", "threat intel"],
    title: "Darknet Intelligence: Monitoring Leaked Credentials and Exploit Forums",
    category: "Security",
    procedure: "To monitor dark web threat intelligence feed pipelines: 1. Setup secure automated scrapers on Tor proxy networks targeting known leak forums and pastebins. 2. Use hashing filters (SHA-256) on target corporate email suffixes (e.g., '@company.com') to identify active exposures. 3. Instantly trigger forced API token revocations and mandatory corporate password rotations upon confirming valid compromises in active forums."
  },
  {
    id: "kb-cybersecurity-ransomware",
    keywords: ["ransomware", "blast containment", "incident response", "segmentation", "malware", "compromise"],
    title: "Cyber Security: Ransomware Triage and Lateral Movement Containment",
    category: "Security",
    procedure: "During an active ransomware outbreak: 1. Isolate the affected subnet instantly by disabling switch core links or revoking active virtual machine network interface cards. 2. Disable Active Directory (AD) trust relationships to stop lateral movement via SMB/PsExec or remote PowerShell. 3. Terminate compromised domain admin active sessions. 4. Recover exclusively from cold-tier, immutable, write-once-read-many (WORM) storage systems after performing root-cause verification."
  },
  {
    id: "kb-cybersecurity-siem",
    keywords: ["siem", "splunk", "threat hunting", "lateral movement", "powershell logs", "sysmon"],
    title: "Cyber Security: Threat Hunting Lateral Movement with Splunk SPL",
    category: "Security",
    procedure: "To search for lateral movement in Splunk: 1. Query active WinEventLog Security ID 4624 (Successful Logon) paired with Logon Type 3 (Network) or 10 (RDP): 'index=windows EventCode=4624 (Logon_Type=3 OR Logon_Type=10)'. 2. Check Sysmon Event ID 1 (Process Creation) for abnormal spawning under wsmprovhost.exe or psexec.exe. 3. Flag indicators of compromise (IOCs) such as encoded PowerShell command-line strings ('-enc' or '-EncodedCommand')."
  },
  {
    id: "kb-cybersecurity-edr",
    keywords: ["edr", "crowdstrike", "defender", "endpoint", "memory injection", "process hollowing", "triage"],
    title: "Cyber Security: EDR Alert Management & Process Memory Hollowing Triage",
    category: "Security",
    procedure: "When an Endpoint Detection and Response (EDR) platform flags a memory injection alert: 1. Analyze the process tree for anomalies (e.g., svchost.exe spawned by a non-system user or running out of %TEMP%). 2. Dump active process memory to disk using Sysinternals ProcDump. 3. Examine handles, DLL loads, and thread execution headers for signs of Process Hollowing or API hooking. 4. Isolate the endpoint from the network via the EDR console while performing in-depth system memory audits."
  },
  {
    id: "kb-cisco-firewall-exploits",
    keywords: ["cisco exploits", "cisco firewall exploits", "cisco firewall", "cisco firewalls", "cisco vulnerability", "cisco vulnerabilities", "arcanedoor", "cve-2024-20353", "cve-2024-20359"],
    title: "Cisco Firewall Active Exploits & ArcaneDoor Zero-Day Mitigation",
    category: "Security",
    procedure: "During active zero-day campaigns targeting Cisco Firewalls (such as the 2024 'ArcaneDoor' state-sponsored attacks): 1. Threat actors exploit CVE-2024-20353 (Denial of Service) and CVE-2024-20359 (remote-access web portal execution) on Cisco ASA/FTD. 2. Verify integrity by checking for memory implants (e.g., 'Line Runner' or 'Line Dancer') using specialized core dump analysis. 3. Immediately patch to clean ASA releases. 4. Disable clientless remote-access portals if not strictly needed, or enforce source-IP access restrictions to trusted administrators."
  },
  {
    id: "kb-zero-day-criticality",
    keywords: ["criticality of zero day", "zero day criticality", "zero day", "zeroday", "severity of zero day", "cvss score", "criticality"],
    title: "Cyber Security: Criticality of Zero-Day Vulnerabilities",
    category: "Security",
    procedure: "Zero-day vulnerabilities represent the highest tier of corporate security risk, consistently categorized as CRITICAL (typically scoring CVSS 9.8 - 10.0). Since no official software patch exists at the time of active exploitation, security teams must immediately establish compensating controls: 1. Deploy deep packet inspection signatures on Palo Alto/perimeter firewalls. 2. Implement strict network segmentation to isolate potential attack hosts. 3. Configure behavior-based EDR rules to block suspicious process spawn trees."
  },
  {
    id: "kb-platform-value",
    keywords: ["operational value", "operational values", "what problem", "problem it is solving", "management", "roi", "business value"],
    title: "Platform Operational Value & ROI",
    category: "Core Services",
    procedure: "This platform serves as a force-multiplying Digital Twin for network and security operations. It solves the problem of alert fatigue, high MTTR (Mean Time To Resolution), and knowledge siloing by providing deterministic, real-time telemetry syncing and instant playbook execution. Operationally, it drastically reduces Tier 1/2 triage time during critical incidents (like zero-day active exploits or network loops), enforces standardized remediation procedures (like deterministic BGP path prepends), and guarantees 24/7 high-availability automated incident response. This brings immense business value by minimizing costly downtime, augmenting engineering staff, and ensuring strictly compliant security posture management."
  },
  {
    id: "kb-dynamic-ospf",
    keywords: ["ospf", "dynamic routing", "link-state", "dijkstra", "dr/bdr", "lsa", "area 0"],
    title: "OSPF (Open Shortest Path First) Configuration & Troubleshooting",
    category: "Routing",
    procedure: "OSPF is a link-state routing protocol using the Dijkstra SPF algorithm. 1. Design networks hierarchically around Area 0 (Backbone). 2. For troubleshooting neighbor adjacency, verify MTU match, Hello/Dead timers, subnet masks, and Area ID. 3. In broadcast networks, verify DR/BDR elections. 4. Check LSA types using 'show ip ospf database' to trace route propagation issues."
  },
  {
    id: "kb-dynamic-bgp-ibgp",
    keywords: ["bgp", "ibgp", "ebgp", "border gateway protocol", "route reflector", "as number"],
    title: "BGP and iBGP Routing Principles",
    category: "Routing",
    procedure: "BGP is a path-vector protocol (TCP port 179). eBGP connects different ASNs, while iBGP operates within the same ASN. 1. iBGP requires a full mesh or Route Reflectors (RR) because it does not forward learned routes to other iBGP peers (split-horizon rule). 2. Use 'show ip bgp summary' to check neighbor states (must be 'Established'). 3. Manipulate inbound traffic using AS-Path Prepending and outbound traffic using Local Preference."
  },
  {
    id: "kb-dynamic-ripv2-isis",
    keywords: ["ripv2", "rip", "isis", "is-is", "distance-vector", "hop count", "clns"],
    title: "RIPv2 and IS-IS Routing Protocols",
    category: "Routing",
    procedure: "RIPv2 is a distance-vector protocol using hop counts (max 15) and multicasting routing updates to 224.0.0.9. IS-IS is a link-state protocol originally for CLNS, utilizing Level 1 (intra-area) and Level 2 (inter-area) routing. For RIPv2, check for split-horizon or hold-down timer issues if routes loop. For IS-IS, verify CLNS NET addresses and NSAP format to ensure Level 1/2 adjacencies form using 'show isis neighbors'."
  },
  {
    id: "kb-cisco-ise",
    keywords: ["cisco ise", "ise", "identity services engine", "nac", "802.1x", "mab", "trustsec", "radius"],
    title: "Cisco ISE (Identity Services Engine) & Network Access Control",
    category: "Security",
    procedure: "Cisco ISE enforces zero-trust access. 1. For 802.1X failures, verify RADIUS shared secrets and client supplicant settings. 2. For IoT/Printers lacking 802.1X, utilize MAC Authentication Bypass (MAB) with profiling. 3. Troubleshoot active sessions via 'Live Logs' in the ISE GUI to spot EAP negotiation timeouts or Authorization Policy mismatches. 4. Implement Cisco TrustSec for Scalable Group Tags (SGT) based micro-segmentation."
  },
  {
    id: "kb-cisco-ftd",
    keywords: ["cisco ftd", "ftd", "firepower", "fmc", "snort", "next-gen firewall", "ngfw"],
    title: "Cisco FTD (Firepower Threat Defense) Operations",
    category: "Security",
    procedure: "Cisco FTD unifies ASA and Firepower (Snort) services. 1. Manage policies centrally via FMC (Firepower Management Center). 2. When troubleshooting dropped traffic, use the FTD CLI tool 'system support trace' to simulate packet flow. 3. Check Intrusion Policies and pre-filter rules. 4. Ensure Snort engine resources aren't oversubscribed, which can cause latency or packet drops during deep packet inspection."
  },
  {
    id: "kb-cisco-switches",
    keywords: ["cisco switches", "catalyst", "nexus", "stackwise", "vss", "vtp", "sd-access"],
    title: "Cisco Catalyst & Nexus Switches Architecture",
    category: "Routing",
    procedure: "1. For Catalyst 9000 series, leverage StackWise Virtual (or VSS) to combine control planes, eliminating STP blocked ports. 2. Troubleshoot layer 2 issues using 'show mac address-table' and verify VTP (VLAN Trunking Protocol) domain/revision numbers to avoid VLAN wipes. 3. Monitor TCAM utilization. 4. For modern campus architectures, manage fabrics using Cisco DNA Center (SD-Access) leveraging LISP and TrustSec."
  },
  {
    id: "kb-cisco-wlc-ap",
    keywords: ["cisco wlc", "wlc", "access point", "capwap", "flexconnect", "mobility group", "wireless"],
    title: "Cisco WLC & Access Points (CAPWAP, FlexConnect)",
    category: "Wireless",
    procedure: "To troubleshoot Cisco WLCs and APs: 1. Verify APs can reach the WLC IP to build the CAPWAP tunnel (UDP 5246/5247). Check DHCP option 43 or DNS (CISCO-CAPWAP-CONTROLLER). 2. For remote branches, deploy FlexConnect to switch client traffic locally if the WAN drops. 3. Configure Mobility Groups for seamless roaming across WLCs. 4. Check 'show ap join stats summary' for certificate or regulatory domain mismatches."
  },
  {
    id: "kb-ngfw",
    keywords: ["ngfw", "next generation firewall", "app-id", "deep packet inspection", "ssl decryption", "fortinet", "check point", "palo alto"],
    title: "Next Generation Firewalls (NGFW) & Deep Inspection",
    category: "Security",
    procedure: "Modern NGFWs (Palo Alto, Fortinet, Check Point, FTD) move beyond Layer 4 stateful inspection. 1. They enforce Application Visibility and Control (App-ID) via Layer 7 deep packet inspection. 2. Enable SSL/TLS decryption (Forward Proxy) to inspect encrypted payloads for malware. 3. Integrate inline IPS/IDS and zero-day sandboxing (e.g., WildFire, FortiSandbox). 4. Beware of CPU exhaustion when enabling full SSL decryption; apply decryption exclusions for trusted financial/medical traffic."
  },
  {
    id: "kb-phishing-basics",
    keywords: ["phishing", "phishing attack", "phishing attacks"],
    title: "Phishing Attack Basics",
    category: "Security",
    procedure: "Phishing is a social-engineering attack in which an attacker impersonates a trusted person or service to trick someone into revealing credentials, opening a malicious attachment, transferring money, or visiting a fraudulent website. Common signs include an unexpected request, urgency, a mismatched sender or link domain, and requests for passwords or codes. Do not click the link or open the attachment; verify the request through a separate trusted channel and report it to the security team."
  },
  {
    id: "kb-darkweb-url-exfiltration",
    keywords: ["darkweb", "dark web", "malicious link", "data theft", "data exposed", "cyber security", "data stolen", "click any urls"],
    title: "Dark Web Operations & Malicious URL Data Exfiltration",
    category: "Security",
    procedure: "When a user clicks a malicious URL, it initiates an attack chain (Drive-by Download, XSS, or browser zero-day exploit) that executes an initial payload. This drops an infostealer (like RedLine, Vidar, or Raccoon) onto the endpoint. 1. The infostealer targets browser SQLite databases to extract saved passwords, session cookies, autofill data, and crypto wallets. 2. This data is zipped and exfiltrated to a Command & Control (C2) server over encrypted channels. 3. The stolen data is then packaged as 'logs' and sold on Dark Web marketplaces via Tor (.onion) hidden services to Initial Access Brokers (IABs). As a cyber security expert, the immediate defense is to sever the C2 connection, rotate all exposed session tokens, and deploy EDR to contain the endpoint."
  }
];

export function findKBArticle(query: string): KBArticle | null {
  const q = query.toLowerCase().trim().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "");
  if (!q) return null;

  // Exact matching keyword check first
  for (const article of KNOWLEDGE_BASE) {
    if (article.keywords.some(kw => q === kw)) {
      return article;
    }
  }

  // Best matches based on token coverage
  let bestMatch: KBArticle | null = null;
  let maxScore = 0;

  for (const article of KNOWLEDGE_BASE) {
    let score = 0;
    for (const kw of article.keywords) {
      const regex = new RegExp(`\\b${kw}\\b`, "i");
      if (regex.test(q)) {
        // Multi-word keywords get a higher match score
        score += kw.split(" ").length * 2;
      } else if (q.includes(kw)) {
        score += kw.split(" ").length;
      }
    }
    if (score > maxScore) {
      maxScore = score;
      bestMatch = article;
    }
  }

  // Require a minimum match score to avoid false positives (score >= 2 ensures at least one strong keyword or multi-token match)
  return maxScore >= 2 ? bestMatch : null;
}
