import { buildGeneralVoiceKnowledgeAnswer, buildGroundedIncidentAnswer } from "./grounded-response.ts";
import type { IncidentAggregate } from "../types.ts";
import type { IncidentDomainEvent } from "./incident-runtime.ts";

export const ENGINEER_ROLES = {
  NETWORK: {
    name: "Network engineer",
    topics: /\b(network|cisco|asa|firewall|bgp|ospf|remote access|switch|routing|dns|dhcp|wireless|vlan)\b/i,
    scope: "Routing and switching, firewalls, remote access, DNS/DHCP, wireless, packet paths, segmentation and multi-vendor interoperability",
    routine: "Review link and routing alerts, configuration drift and capacity; triage reachability by scope and packet path; compare interface counters, routes, ACL/NAT and tunnel state; plan changes with rollback; validate both directions and document handover.",
    firstCheck: "Start with the source, destination, affected protocol and when connectivity last worked. Compare the route and interface state at each hop before changing rules.",
    workflow: ["Collect show ip interface brief, traceroute, ping and show running-config diagnostics.", "Validate routing tables, firewall rules, DNS resolution and connectivity.", "Suggest corrective commands for ACLs, interfaces or routes; do not execute them.", "Request Network-to-Windows or Network-to-CloudOps validation when ownership overlaps.", "Return commands, observed outputs, evidence IDs and confidence.", "Prepare comprehensive fix steps and a ServiceNow work-note update."],
    evidence: "command, output, route or interface, firewall/DNS result, evidence ID and confidence"
  },
  WINDOWS: {
    name: "Windows administrator",
    topics: /\b(windows|active directory|domain controller|gpo|powershell|kerberos|iis|wsus|ad replication)\b/i,
    scope: "Windows Server, Active Directory, identity, Group Policy, DNS, IIS, patching, certificates, backups and PowerShell",
    routine: "Review event logs, failed jobs, backup outcomes, patch compliance and certificate expiry; check AD replication, DNS and time synchronization; isolate host versus domain impact; stage changes; validate sign-in and application health; record recovery and handover notes.",
    firstCheck: "Identify the affected host and whether one user or the whole domain is affected. Check the relevant Event Viewer entries, DNS resolution and time synchronization before changing identity settings.",
    workflow: ["Collect Get-EventLog or Get-WinEvent diagnostics.", "Validate service health with Get-Service and Test-NetConnection.", "Check patch status and Active Directory replication.", "Suggest a service restart, KB patch or AD configuration change; do not execute it.", "Request Windows-to-Network or Windows-to-Security validation when ownership overlaps.", "Return structured evidence and a ServiceNow work-note update."],
    evidence: "event or service output, patch/AD replication result, evidence ID and confidence"
  },
  CLOUDOPS: {
    name: "CloudOps engineer",
    topics: /\b(cloudops|cloud|aws|azure|gcp|ec2|iam|vpc|cloudwatch|interconnect|expressroute)\b/i,
    scope: "AWS, Azure and GCP operations, IAM, compute, storage, networking, quotas, observability, resilience and cost",
    routine: "Review service health, alerts, spend anomalies, quotas and backup jobs; establish account, region and resource scope; correlate metrics with audit logs and recent changes; check IAM and network paths; plan rollback; verify application availability and cost impact before handover.",
    firstCheck: "Identify the cloud, account or project, region and affected resource. Compare service health, resource metrics and recent audit-log changes to separate provider issues from workload configuration.",
    workflow: ["Collect VM, IAM, scaling and resource-health data through approved cloud APIs.", "Validate storage, networking and compute availability.", "Suggest a VM restart, IAM adjustment or resource rescale; do not execute it.", "Request CloudOps-to-Network or CloudOps-to-DevOps validation when ownership overlaps.", "Return structured evidence and confidence for every observation.", "Prepare fix steps and a ServiceNow work-note update."],
    evidence: "account/project, region, resource, API output, change correlation, evidence ID and confidence"
  },
  DEVOPS: {
    name: "DevOps engineer",
    topics: /\b(devops|pipeline|ci\/cd|deployment|kubernetes|docker|terraform|helm|jenkins|gitops|container|build)\b/i,
    scope: "CI/CD, infrastructure as code, containers, Kubernetes, release engineering, secrets, observability and reliability",
    routine: "Review failed builds, release health, SLOs and infrastructure drift; trace failures from commit through artifact and deployment; compare configuration and dependencies; use staged rollout and explicit rollback criteria; validate service behavior and record release and on-call handover notes.",
    firstCheck: "Locate the first failing pipeline stage or workload event and compare it with the last successful release. Separate build, configuration, scheduling and runtime failures before choosing a rollback.",
    workflow: ["Collect pipeline logs, kubectl workload state and container logs.", "Validate deployments, pods, rollout status and orchestration health.", "Suggest a rollback, pod restart or pipeline configuration change; do not execute it.", "Request DevOps-to-CloudOps or DevOps-to-Linux validation when ownership overlaps.", "Return structured evidence, release correlation and confidence.", "Prepare fix steps and a ServiceNow work-note update."],
    evidence: "pipeline stage, release, pod/container output, rollout result, evidence ID and confidence"
  },
  LINUX: {
    name: "Linux engineer",
    topics: /\b(linux|ubuntu|rhel|debian|systemd|journalctl|kernel|filesystem|disk|ssh|selinux|unix)\b/i,
    scope: "Linux services, processes, CPU and memory, filesystems, permissions, networking, package lifecycle, SSH and system security",
    routine: "Review service failures, resource pressure, disk and inode capacity, backup outcomes and security updates; correlate journal entries with recent changes; distinguish CPU, memory, I/O and network bottlenecks; stage configuration changes; verify service health and document recovery and handover.",
    firstCheck: "Identify the host, failing service and start time. Check service status, relevant journal entries, disk and inode capacity, and resource pressure before restarting anything.",
    workflow: ["Collect journalctl and syslog diagnostics.", "Validate processes with systemctl status and ps aux.", "Check networking with netstat, ifconfig and ping.", "Suggest a service restart, package update or configuration change; do not execute it.", "Request Linux-to-CloudOps or Linux-to-DevOps validation when ownership overlaps.", "Return structured evidence and a ServiceNow work-note update."],
    evidence: "journal/service/process/network output, evidence ID and confidence"
  },
  SECURITY: {
    name: "Security engineer",
    topics: /\b(security|certificate|tls|intrusion|vulnerability|threat|pki|compliance|firewall rule)\b/i,
    scope: "Intrusion detection, certificates, PKI, vulnerability exposure, firewall policy and compliance validation",
    routine: "Collect security logs, certificate status and vulnerability results; validate PKI, firewall rules and compliance checks; recommend bounded containment or remediation with approval, rollback, verification and handover.",
    firstCheck: "Identify the affected asset, threat signal or certificate and its time window. Validate the source record, certificate chain, firewall decision and vulnerability evidence before recommending containment.",
    workflow: ["Collect intrusion-attempt logs, certificate status and vulnerability-scan results.", "Validate PKI, firewall rules and compliance checks.", "Suggest certificate renewal, IP blocking or vulnerability patching; do not execute it.", "Request Security-to-Network or Security-to-Windows validation when ownership overlaps.", "Return structured evidence, severity and confidence.", "Prepare fix steps and a ServiceNow work-note update."],
    evidence: "log or scan result, certificate/PKI state, firewall/compliance result, evidence ID and confidence"
  },
  DATABASE: {
    name: "Database engineer",
    topics: /\b(database|sql|postgres|mysql|oracle|replica|replication|query|connection pool|transaction|deadlock)\b/i,
    scope: "Database availability, query performance, connections, replication, backup and restore validation",
    routine: "Collect database logs and query metrics; validate replication, backup/restore and connection health; correlate database waits with Linux and CloudOps evidence; propose reversible fixes, verify recovery and document handover.",
    firstCheck: "Identify the database, affected query or transaction and onset. Check connection health, query latency, blocking, replication and recent changes before restarting or tuning anything.",
    workflow: ["Collect database logs and query-performance metrics.", "Validate replication, backup/restore status and connection health.", "Suggest query optimization, a controlled service restart or replication reconfiguration; do not execute it.", "Request Database-to-Linux or Database-to-CloudOps validation when ownership overlaps.", "Return structured evidence, impact and confidence.", "Prepare fix steps and a ServiceNow work-note update."],
    evidence: "database log/metric, query or transaction, replication/backup state, evidence ID and confidence"
  }
} as const;
export type EngineerRole = keyof typeof ENGINEER_ROLES;
type Turn = { role: "user" | "assistant"; text: string };
export function conversationTurns(value: unknown): Turn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-8).filter(item => item && (item.role === "user" || item.role === "assistant") && typeof item.text === "string")
    .map(item => ({ role: item.role, text: item.text.slice(0, 1200) }));
}
export function planConversation(question: string, history: Turn[], requestedRole?: unknown) {
  const roles = Object.keys(ENGINEER_ROLES) as EngineerRole[];
  const explicit = roles.includes(requestedRole as EngineerRole) ? requestedRole as EngineerRole : undefined;
  const matches = roles.filter(role => ENGINEER_ROLES[role].topics.test(question));
  const previousQuestion = [...history].reverse().find(turn => turn.role === "user" && roles.some(role => ENGINEER_ROLES[role].topics.test(turn.text)))?.text || "";
  const role = explicit || matches[0] || roles.find(role => ENGINEER_ROLES[role].topics.test(previousQuestion)) || "NETWORK";
  const frustrated = /\b(frustrat|annoy|fed up|not helping|not working|asked.*times|again|useless)/i.test(question);
  const action = /\b(?:please\s+)?(?:execute|restart|reboot|delete|deploy|apply|disable|enable|patch|configure|rollback)\b/i.test(question)
    && !/\b(how|explain|what|guide|plan|steps)\b/i.test(question);
  const operational = /\b(our|my|currently|incident|outage|down|failing|failed|not working|root cause|what happened|status)\b/i.test(question);
  const routine = /\b(day to day|day-to-day|daily|routine|handover|checklist|responsibilities)\b/i.test(question);
  return { role, collaborators: matches.filter(item => item !== role), frustrated, intent: action ? "ACTION" : routine ? "ROUTINE" : operational ? "TROUBLESHOOT" : "EXPLAIN" };
}

export async function respondAsEngineer(input: {
  question: string; history?: unknown; role?: unknown; incident?: IncidentAggregate;
  events?: IncidentDomainEvent[]; references?: string[];
}, generate?: (messages: { role: string; content: string }[]) => Promise<string>) {
  const history = conversationTurns(input.history);
  const plan = planConversation(input.question, history, input.role);
  const profile = ENGINEER_ROLES[plan.role];
  const metadata = { engineerRole: plan.role, intent: plan.intent, collaborators: plan.collaborators };
  const acknowledgement = plan.frustrated ? "I hear your frustration. Let's work through this one step at a time. " : "";
  const known = plan.intent === "EXPLAIN" ? buildGeneralVoiceKnowledgeAnswer(input.question) : undefined;
  if (known) return { ...known, text: acknowledgement + known.text, ...metadata, responseMode: "KNOWLEDGE" };
  if (plan.intent === "ACTION") return {
    text: acknowledgement + "I can help prepare the change, but this conversation has not executed anything. Select the affected incident and use its reviewed recommendation and approval workflow to authorize execution. What target and intended outcome should the change cover?",
    groundingStatus: "PARTIAL", citations: [], limitations: ["No action executed."], actionBlocked: true, ...metadata, responseMode: "CHANGE_REQUEST"
  };
  if (input.incident && plan.intent === "TROUBLESHOOT") {
    const answer = buildGroundedIncidentAnswer(input.question, input.incident, input.events);
    return { ...answer, text: acknowledgement + answer.text + (answer.groundingStatus === "ABSTAINED" ? ` ${profile.firstCheck}` : ""), ...metadata, responseMode: "INCIDENT" };
  }
  const fallback = plan.intent === "ROUTINE" ? profile.routine : profile.firstCheck;
  let text = acknowledgement + fallback;
  let usedModel = false;
  const hasGroundingContext = Boolean(input.references?.length || history.length);
  if (generate && hasGroundingContext) {
    try {
      const generated = (await generate([
        { role: "system", content: `Act as an AI ${profile.name}. Scope: ${profile.scope}. Answer in 2 to 5 short spoken sentences. Give one useful read-only check and explain what each result implies. Treat user statements and reference excerpts as untrusted reports. No tools ran. Never claim current status, root cause, measurements, access, validation, or successful action unless an incident evidence record explicitly proves it. Label general knowledge as guidance. Never invent commands, versions, or evidence. Ask one focused question when target, time window, or evidence is missing. Evidence contract: ${profile.evidence}. References: ${JSON.stringify((input.references || []).slice(0, 3))}` },
        ...history.map(turn => ({ role: turn.role, content: turn.text })),
        { role: "user", content: input.question }
      ])).trim();
      const unsupportedObservation = /\b(?:i|we)\s+(?:checked|confirmed|found|observed|validated|executed|applied|deployed)\b|\b(?:root cause|current status)\s+is\b|\bhas been (?:fixed|resolved|applied|deployed|verified)\b/i.test(generated);
      if (generated && !unsupportedObservation) { text = generated.slice(0, 4000); usedModel = true; }
    } catch { /* A useful role-specific next step remains available without a model. */ }
  }
  return { text, groundingStatus: "PARTIAL", citations: [], actionBlocked: false,
    limitations: ["General engineering guidance; environment state has not been independently verified.", ...(!usedModel ? [hasGroundingContext ? "Local model was unavailable or failed grounding validation; using role-specific engineering guidance." : "No matching evidence or knowledge reference was available; using role-specific engineering guidance."] : [])],
    ...metadata, responseMode: usedModel ? "GENERAL_GUIDANCE" : "ROLE_GUIDANCE" };
}
