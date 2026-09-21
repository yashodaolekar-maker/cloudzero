export type AdapterCoverage = "CONNECTED" | "SIMULATED" | "PARTIAL" | "PLANNED";

export interface TwinCapability {
  name: string;
  kind: "SYSTEM" | "PROTOCOL" | "VENDOR" | "DOMAIN";
  confidence: number;
  coverage: AdapterCoverage;
}

export interface TwinWorkflowStep {
  phase: "OBSERVE" | "CORRELATE" | "VALIDATE" | "PROPOSE" | "HUMAN_GATE";
  title: string;
  command?: string;
  validation: string;
  guidance: string;
}

export interface TwinWorkflow {
  id: string;
  title: string;
  trigger: string;
  sourceLabel: string;
  approval: string;
  steps: TwinWorkflowStep[];
}

export interface TwinKnowledgeArticle {
  id: string;
  title: string;
  source: string;
  provenance: "CURATED_LOCAL" | "INDEXED_DOCUMENT";
  keywords: string[];
  summary: string;
}

export interface TwinWorkspaceProfile {
  id: string;
  role: string;
  title: string;
  posture: string;
  summary: string;
  capabilities: TwinCapability[];
  workflows: TwinWorkflow[];
  knowledge: TwinKnowledgeArticle[];
  examples: string[];
  collaborators: string[];
}

const step = (phase: TwinWorkflowStep["phase"], title: string, validation: string, guidance: string, command?: string): TwinWorkflowStep => ({ phase, title, validation, guidance, command });
const cap = (name: string, kind: TwinCapability["kind"], confidence: number, coverage: AdapterCoverage): TwinCapability => ({ name, kind, confidence, coverage });
const article = (id: string, title: string, source: string, keywords: string[], summary: string): TwinKnowledgeArticle => ({ id, title, source, keywords, summary, provenance: "CURATED_LOCAL" });

function workflow(id: string, title: string, trigger: string, command: string, validation: string, remediation: string, sourceLabel: string): TwinWorkflow {
  return {
    id, title, trigger, sourceLabel,
    approval: "A human operator must approve any configuration or service-changing action.",
    steps: [
      step("OBSERVE", "Bound the symptom", "Timestamp, affected configuration item, and blast radius are recorded.", "Preserve the original alert and incident window."),
      step("CORRELATE", "Check adjacent domains", "Cross-twin evidence refers to the same incident, target, and time window.", "Request only the evidence needed to test the current hypothesis."),
      step("VALIDATE", "Run an allowlisted read-only check", validation, "Retain command, output status, timestamp, and evidence identifier.", command),
      step("PROPOSE", "Draft the lowest-risk response", "The proposal contains verification and rollback criteria.", remediation),
      step("HUMAN_GATE", "Request approval", "No mutating command is executed by this simulation.", "Escalate to the service owner and change approver with the evidence chain.")
    ]
  };
}

const profiles: TwinWorkspaceProfile[] = [
  {
    id: "networking", role: "NETWORK", title: "Networking Twin", posture: "Read-only diagnostics · cross-domain correlation",
    summary: "Validates forwarding, routing, wireless, security-policy, address services, and software-defined WAN evidence before proposing a change.",
    capabilities: [cap("Cisco IOS XE / ASR / Catalyst", "VENDOR", 94, "SIMULATED"), cap("Palo Alto PAN-OS", "VENDOR", 89, "SIMULATED"), cap("Zscaler", "VENDOR", 76, "PLANNED"), cap("Silver Peak EdgeConnect", "VENDOR", 83, "PARTIAL"), cap("Infoblox", "VENDOR", 87, "PARTIAL"), cap("BGP / OSPF / VLAN / STP", "PROTOCOL", 93, "SIMULATED"), cap("DNS / DHCP", "DOMAIN", 91, "PARTIAL"), cap("Wireless / 802.1X", "DOMAIN", 88, "SIMULATED")],
    workflows: [workflow("net-bgp", "BGP route flap", "Neighbor resets or unstable prefix reachability", "show ip bgp summary", "Neighbor state, uptime, prefix counts, and reset timing support or reject a routing hypothesis.", "Propose timer, policy, or transport correction only after peer-side correlation.", "Curated runbook; verify against the deployed Cisco release guide."), workflow("net-dhcp", "DHCP allocation failure", "Clients fail to receive or renew an address", "show ip interface brief", "Gateway interface state and relay path are recorded before checking the address service.", "Propose relay, scope, or policy correction after Networking and Windows evidence agree.", "Curated operational guidance; Infoblox documentation must be attached for production use.")],
    knowledge: [article("net-kb-dhcp", "DHCP relay triage", "Curated Cloud Zero SOP", ["dhcp", "infoblox", "helper", "lease"], "Verify client VLAN, relay interface, helper target, scope availability, and UDP path in the same incident window."), article("net-kb-bgp", "BGP adjacency triage", "Curated Cloud Zero SOP", ["bgp", "cisco", "asr", "route flap"], "Compare neighbor state, reset time, transport reachability, policy changes, and peer-side logs before attributing the fault.")],
    examples: ["BGP route flap on Cisco ASR", "DHCP leases exhausted for branch clients", "Wireless clients fail after roaming"], collaborators: ["Security", "CloudOps", "Windows", "SRE"]
  },
  {
    id: "windows", role: "WINDOWS", title: "Windows Twin", posture: "Host evidence · identity and name-service validation", summary: "Correlates Windows host, directory, DNS, certificate, and service evidence with network observations.",
    capabilities: [cap("Windows Server", "SYSTEM", 95, "SIMULATED"), cap("Active Directory", "SYSTEM", 91, "PARTIAL"), cap("PowerShell", "SYSTEM", 95, "SIMULATED"), cap("DNS / DHCP", "DOMAIN", 92, "PARTIAL"), cap("Kerberos / TLS", "PROTOCOL", 88, "PARTIAL")],
    workflows: [workflow("win-connectivity", "Windows service reachability", "A Windows workload cannot reach a dependency", "Get-NetIPConfiguration; Get-NetRoute -AddressFamily IPv4; Test-NetConnection -ComputerName affected-service -InformationLevel Detailed", "Addressing, selected route, DNS result, and endpoint probe are evaluated together.", "Propose service or host configuration changes only after network-path evidence is correlated.", "Curated Microsoft-aligned operational procedure; link the applicable product article before execution.")],
    knowledge: [article("win-kb-dns", "Windows DNS client validation", "Curated Cloud Zero SOP", ["dns", "windows", "resolve", "infoblox"], "Capture resolver addresses and Resolve-DnsName output, then compare the answer and timestamp with authoritative DNS evidence.")], examples: ["Domain controller authentication timeout", "DNS works on network devices but fails on Windows host"], collaborators: ["Networking", "Security", "SRE"]
  },
  {
    id: "dba", role: "DATABASE", title: "DBA Twin", posture: "Connection and transaction evidence", summary: "Examines database connectivity, capacity, replication, query, and transaction health without changing data.",
    capabilities: [cap("PostgreSQL", "SYSTEM", 92, "SIMULATED"), cap("Oracle", "SYSTEM", 82, "PLANNED"), cap("Microsoft SQL Server", "SYSTEM", 85, "PARTIAL"), cap("Connections / replication", "DOMAIN", 91, "SIMULATED")],
    workflows: [workflow("dba-connections", "Connection exhaustion", "Applications time out while opening database sessions", "database-playbook connection-health --read-only", "Connection utilization, wait classes, and rejected-session timestamps align with the incident.", "Propose pool tuning or capacity changes with application-owner validation.", "Curated database operations SOP.")],
    knowledge: [article("dba-kb-pool", "Connection pool correlation", "Curated Cloud Zero SOP", ["connection", "pool", "postgres", "timeout"], "Compare database saturation with client pool configuration and deployment timing before assigning root cause.")], examples: ["PostgreSQL connection limit reached"], collaborators: ["Middleware", "DevOps", "SRE"]
  },
  {
    id: "cloudops", role: "CLOUDOPS", title: "CloudOps Twin", posture: "Provider health · topology correlation", summary: "Validates cloud resource health, routing, identity, quotas, and provisioning state across provider boundaries.",
    capabilities: [cap("Azure", "VENDOR", 91, "PARTIAL"), cap("AWS", "VENDOR", 90, "PARTIAL"), cap("Google Cloud", "VENDOR", 87, "PARTIAL"), cap("Cloud provisioning", "DOMAIN", 92, "SIMULATED"), cap("ExpressRoute / Direct Connect", "DOMAIN", 86, "PARTIAL")],
    workflows: [workflow("cloud-route", "Hybrid route degradation", "Cloud and on-premises reachability diverge", "cloud-playbook resource-health --read-only", "Provider health, gateway state, effective routes, and network evidence share the same time window.", "Propose route or gateway changes after both boundary owners confirm the path.", "Curated multi-cloud operations SOP.")], knowledge: [article("cloud-kb-hybrid", "Hybrid connectivity evidence", "Curated Cloud Zero SOP", ["expressroute", "direct connect", "cloud", "routing"], "Correlate provider circuit state and effective routes with on-premises BGP evidence.")], examples: ["ExpressRoute latency increased after route change"], collaborators: ["Networking", "Security", "SRE"]
  },
  {
    id: "devops", role: "DEVOPS", title: "DevOps Twin", posture: "Deployment and runtime evidence", summary: "Correlates pipelines, Kubernetes events, releases, configuration drift, and rollback readiness.",
    capabilities: [cap("Kubernetes", "SYSTEM", 94, "SIMULATED"), cap("GitHub Actions", "SYSTEM", 88, "PARTIAL"), cap("CI/CD", "DOMAIN", 94, "PARTIAL"), cap("GitOps", "DOMAIN", 87, "PLANNED")],
    workflows: [workflow("devops-rollout", "Failed workload rollout", "A deployment loses readiness or availability", "kubectl get events -n affected-namespace --sort-by=.lastTimestamp", "Events, replica health, image revision, and deployment time identify the failing boundary.", "Propose rollback only when the prior revision and post-checks are documented.", "Curated Kubernetes operations SOP.")], knowledge: [article("devops-kb-rollout", "Deployment failure triage", "Curated Cloud Zero SOP", ["kubernetes", "deployment", "pipeline", "rollback"], "Tie cluster events to the exact release SHA and retain rollback verification criteria.")], examples: ["Kubernetes rollout stuck with unavailable replicas"], collaborators: ["SRE", "Middleware", "CloudOps"]
  },
  {
    id: "middleware", role: "MIDDLEWARE", title: "Middleware Twin", posture: "Message flow and dependency evidence", summary: "Validates queues, brokers, consumer lag, application dependencies, and certificate handshakes.",
    capabilities: [cap("Kafka", "SYSTEM", 90, "PARTIAL"), cap("RabbitMQ", "SYSTEM", 84, "PLANNED"), cap("TLS certificates", "DOMAIN", 89, "PARTIAL"), cap("Queues / consumer lag", "DOMAIN", 92, "SIMULATED")],
    workflows: [workflow("mid-queue", "Queue backlog", "Consumer lag grows or messages stop flowing", "middleware-playbook queue-health --read-only", "Broker health, partition ownership, consumer lag, and downstream reachability align.", "Propose consumer restart or rebalance through the application owner.", "Curated middleware operations SOP.")], knowledge: [article("mid-kb-lag", "Consumer lag analysis", "Curated Cloud Zero SOP", ["kafka", "queue", "consumer", "lag"], "Separate producer, broker, consumer, and downstream latency with timestamped evidence.")], examples: ["Kafka consumer lag after application release"], collaborators: ["DevOps", "DBA", "Networking"]
  },
  {
    id: "security", role: "SECURITY", title: "Security Twin", posture: "Threat and policy evidence · approval required", summary: "Evaluates security signals, policy decisions, identity, certificates, and exposure while preserving human authority.",
    capabilities: [cap("Palo Alto", "VENDOR", 91, "SIMULATED"), cap("Zscaler", "VENDOR", 78, "PLANNED"), cap("Cisco ISE", "VENDOR", 86, "PARTIAL"), cap("PKI / certificates", "DOMAIN", 91, "PARTIAL"), cap("SIEM correlation", "DOMAIN", 89, "PARTIAL")],
    workflows: [workflow("sec-cert", "Certificate trust failure", "TLS or service identity validation fails", "security-playbook auth-failures --window 15m", "Chain, hostname, validity, revocation, and peer timestamps support the conclusion.", "Propose certificate replacement only through the certificate owner and approved change.", "Curated security operations SOP.")], knowledge: [article("sec-kb-pki", "PKI validation sequence", "Curated Cloud Zero SOP", ["pki", "certificate", "tls", "trust"], "Validate identity, chain, validity, revocation, and clock state before replacing a certificate.")], examples: ["Certificate chain rejected at application gateway"], collaborators: ["Networking", "Windows", "CloudOps"]
  },
  {
    id: "sre", role: "SRE", title: "SRE Twin", posture: "Service health · error-budget context", summary: "Coordinates service impact, telemetry, dependency evidence, mitigation safety, and post-change verification.",
    capabilities: [cap("Service telemetry", "DOMAIN", 93, "PARTIAL"), cap("SLO / error budgets", "DOMAIN", 91, "SIMULATED"), cap("Incident command", "DOMAIN", 94, "SIMULATED"), cap("Distributed systems", "SYSTEM", 88, "PLANNED")],
    workflows: [workflow("sre-degrade", "Service degradation", "Latency or errors breach an operational objective", "sre-playbook service-health --read-only", "Impact, dependency saturation, change timing, and user-journey measurements are correlated.", "Propose the smallest reversible mitigation with monitoring and rollback thresholds.", "Curated SRE incident response SOP.")], knowledge: [article("sre-kb-triage", "Service impact triage", "Curated Cloud Zero SOP", ["slo", "latency", "error", "incident"], "Start with user impact and time bounds, then test dependency and recent-change hypotheses.")], examples: ["Checkout latency exceeds service objective"], collaborators: ["All specialized twins"]
  },
  {
    id: "collaboration", role: "COLLABORATION", title: "Collaboration Twin", posture: "Evidence routing · shared incident context", summary: "Maintains cross-twin questions, evidence bindings, ownership transitions, and auditable decision context.",
    capabilities: [cap("A2A evidence mesh", "SYSTEM", 92, "SIMULATED"), cap("Incident handoffs", "DOMAIN", 90, "SIMULATED"), cap("Teams", "SYSTEM", 75, "PLANNED"), cap("Evidence correlation", "DOMAIN", 93, "SIMULATED")],
    workflows: [workflow("collab-handoff", "Cross-twin handoff", "A hypothesis crosses an ownership boundary", "collaboration-playbook evidence-chain --read-only", "Sender, recipient, incident, target, timestamps, commands, and evidence IDs remain bound.", "Propose an owner only when evidence and limitations are explicit.", "Curated A2A governance SOP.")], knowledge: [article("collab-kb-evidence", "Evidence handoff contract", "Curated Cloud Zero SOP", ["a2a", "handoff", "evidence", "correlation"], "Every handoff states the question, same-incident target, exact checks, observations, limitations, and next owner.")], examples: ["Networking asks Windows to validate host routing"], collaborators: ["All specialized twins"]
  },
  {
    id: "linux", role: "LINUX", title: "Linux Twin", posture: "Host and service evidence", summary: "Validates Linux services, system logs, interfaces, routes, name resolution, and bounded endpoint reachability.",
    capabilities: [cap("RHEL / Ubuntu", "SYSTEM", 91, "SIMULATED"), cap("systemd / journal", "SYSTEM", 94, "SIMULATED"), cap("Linux networking", "DOMAIN", 92, "SIMULATED")],
    workflows: [workflow("linux-service", "Linux dependency failure", "A Linux service cannot reach a dependency", "systemctl --failed --no-pager; ip -brief address; ip route", "Failed units, address state, and route state are captured before attribution.", "Propose service or network correction after dependency evidence is correlated.", "Curated Linux operations SOP.")], knowledge: [article("linux-kb-service", "Linux service correlation", "Curated Cloud Zero SOP", ["linux", "systemd", "route", "service"], "Correlate unit state and journal time with routes, DNS, and dependency probes.")], examples: ["Linux service fails after route update"], collaborators: ["Networking", "DevOps", "SRE"]
  }
];

export const TWIN_WORKSPACES = profiles;

export function findTwinWorkspace(idOrRole: string): TwinWorkspaceProfile | undefined {
  const key = idOrRole.trim().toLowerCase();
  const aliases: Record<string, string> = { network: "networking", database: "dba", agent_network: "networking" };
  const normalized = aliases[key] || key;
  return profiles.find(profile => profile.id === normalized || profile.role.toLowerCase() === normalized);
}

export function redactTwinInput(value: unknown, maxLength = 600): string {
  return String(value ?? "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi, "[REDACTED PRIVATE KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\b(password|passwd|secret|token|credential|authorization)\s*[:=]\s*([^\s,;]+)/gi, "$1=[REDACTED]")
    .replace(/\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/g, "[PRIVATE_IP_REDACTED]")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, "")
    .slice(0, maxLength).trim();
}

export interface TwinSimulationResult {
  label: "SIMULATION";
  incident: string;
  matchedWorkflow: TwinWorkflow;
  collaboration: string[];
  governance: Array<{ label: string; status: "PASS" | "PENDING"; detail: string }>;
}

export function simulateTwinIncident(profile: TwinWorkspaceProfile, input: unknown): TwinSimulationResult {
  const incident = redactTwinInput(input);
  if (!incident) throw new Error("Enter a test incident before running the simulation.");
  const words = incident.toLowerCase().split(/\W+/).filter(Boolean);
  const score = (candidate: TwinWorkflow) => words.filter(word => `${candidate.title} ${candidate.trigger}`.toLowerCase().includes(word)).length;
  const matchedWorkflow = [...profile.workflows].sort((a, b) => score(b) - score(a))[0];
  return {
    label: "SIMULATION",
    incident,
    matchedWorkflow,
    collaboration: profile.collaborators.slice(0, 3).map((name, index) => `${index + 1}. ${profile.title} requests same-incident evidence from ${name} with target and time-window binding.`),
    governance: [
      { label: "Sensitive-data redaction", status: "PASS", detail: "The displayed incident was bounded and sensitive patterns were redacted." },
      { label: "Read-only boundary", status: "PASS", detail: "Only cataloged diagnostic commands are demonstrated." },
      { label: "Vendor citation", status: "PENDING", detail: "Attach the documentation for the deployed vendor and software release before production use." },
      { label: "Immutable ledger", status: "PENDING", detail: "This local demonstration is not written to the production ledger." }
    ]
  };
}

export function searchCuratedTwinKnowledge(profile: TwinWorkspaceProfile, query: string): TwinKnowledgeArticle[] {
  const terms = redactTwinInput(query, 200).toLowerCase().split(/\W+/).filter(term => term.length > 1);
  if (!terms.length) return profile.knowledge;
  return profile.knowledge.filter(item => terms.some(term => `${item.title} ${item.keywords.join(" ")} ${item.summary}`.toLowerCase().includes(term)));
}
