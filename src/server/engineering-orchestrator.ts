import crypto from "node:crypto";
import path from "node:path";
import { readFileSync } from "node:fs";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import type { IncidentAggregate, IncidentEvidence, ServiceNowIncident } from "../types.ts";
import type { SecretProvider } from "./secrets.ts";
import { demoScenarios } from './demo-catalog.ts';

export type EngineerPersona = "NETWORK" | "WINDOWS" | "CLOUDOPS" | "DEVOPS" | "LINUX" | "CLOUDOPS_DEVOPS" | "SECURITY" | "DATABASE" | "MIDDLEWARE";
export type DiagnosticTemplateId =
  | "DATABASE_CONNECTION_HEALTH"
  | "CLOUD_RESOURCE_HEALTH"
  | "MIDDLEWARE_QUEUE_HEALTH"
  | "NETWORK_INTERFACE_SUMMARY"
  | "NETWORK_ACCESS_VLAN"
  | "NETWORK_PATH_MTU"
  | "NETWORK_BGP_SUMMARY"
  | "NETWORK_ROUTE_SUMMARY"
  | "NETWORK_NEIGHBOR_SUMMARY"
  | "NETWORK_FIREWALL_SESSION_SUMMARY"
  | "NETWORK_WIRELESS_CLIENT_SUMMARY"
  | "NETWORK_SDWAN_CONTROL_SUMMARY"
  | "WINDOWS_SERVICE_STATUS"
  | "WINDOWS_RECENT_SYSTEM_ERRORS"
  | "WINDOWS_NETWORK_VALIDATION"
  | "WINDOWS_DNS_VALIDATION"
  | "WINDOWS_KERBEROS_VALIDATION"
  | "WINDOWS_IIS_VALIDATION"
  | "KUBERNETES_WORKLOAD_STATUS"
  | "KUBERNETES_RECENT_EVENTS"
  | "SECURITY_AUTH_FAILURES"
  | "LINUX_SERVICE_FAILURES"
  | "LINUX_NETWORK_VALIDATION"
  | "LINUX_RECENT_ERRORS"
  | "DEVOPS_RECENT_EVENTS"
  | "SECURITY_THREAT_INDICATORS";

export interface DiagnosticTemplate {
  id: DiagnosticTemplateId;
  persona: EngineerPersona;
  command: string;
  readOnly: true;
  parameterNames: string[];
}

const templates: Record<DiagnosticTemplateId, DiagnosticTemplate> = {
  CLOUD_RESOURCE_HEALTH: {id:'CLOUD_RESOURCE_HEALTH',persona:'CLOUDOPS',command:'cloud-playbook resource-health --read-only',readOnly:true,parameterNames:[]},
  MIDDLEWARE_QUEUE_HEALTH: {id:'MIDDLEWARE_QUEUE_HEALTH',persona:'MIDDLEWARE',command:'middleware-playbook queue-health --read-only',readOnly:true,parameterNames:[]},
  DATABASE_CONNECTION_HEALTH: {id:"DATABASE_CONNECTION_HEALTH",persona:"DATABASE",command:"database-playbook connection-health --read-only",readOnly:true,parameterNames:[]},
  LINUX_SERVICE_FAILURES: { id: "LINUX_SERVICE_FAILURES", persona: "LINUX", command: "systemctl --failed --no-pager", readOnly: true, parameterNames: [] },
  LINUX_NETWORK_VALIDATION: { id: "LINUX_NETWORK_VALIDATION", persona: "LINUX", command: "ip -brief address; ip route; getent hosts {{destination_ref}}; timeout 5 bash -c '</dev/tcp/{{destination_ref}}/{{destination_port}}'", readOnly: true, parameterNames: ["destination_ref", "destination_port"] },
  LINUX_RECENT_ERRORS: { id: "LINUX_RECENT_ERRORS", persona: "LINUX", command: "journalctl -p err --since '-30 min' --no-pager -n 100", readOnly: true, parameterNames: [] },
  DEVOPS_RECENT_EVENTS: { id: "DEVOPS_RECENT_EVENTS", persona: "DEVOPS", command: "kubectl get events -n {{namespace}} --sort-by=.lastTimestamp", readOnly: true, parameterNames: ["namespace"] },
  NETWORK_INTERFACE_SUMMARY: { id: "NETWORK_INTERFACE_SUMMARY", persona: "NETWORK", command: "show ip interface brief", readOnly: true, parameterNames: [] },
  NETWORK_ACCESS_VLAN: { id: "NETWORK_ACCESS_VLAN", persona: "NETWORK", command: "show interfaces {{interface_ref}} switchport", readOnly: true, parameterNames: ["interface_ref"] },
  NETWORK_PATH_MTU: { id: "NETWORK_PATH_MTU", persona: "NETWORK", command: "ping {{destination_ref}} size {{packet_size}} df-bit repeat 5", readOnly: true, parameterNames: ["destination_ref", "packet_size"] },
  NETWORK_BGP_SUMMARY: { id: "NETWORK_BGP_SUMMARY", persona: "NETWORK", command: "show ip bgp summary", readOnly: true, parameterNames: [] },
  NETWORK_ROUTE_SUMMARY: { id: "NETWORK_ROUTE_SUMMARY", persona: "NETWORK", command: "show ip route summary", readOnly: true, parameterNames: [] },
  NETWORK_NEIGHBOR_SUMMARY: { id: "NETWORK_NEIGHBOR_SUMMARY", persona: "NETWORK", command: "show cdp neighbors detail", readOnly: true, parameterNames: [] },
  NETWORK_FIREWALL_SESSION_SUMMARY: { id: "NETWORK_FIREWALL_SESSION_SUMMARY", persona: "NETWORK", command: "show session all filter source {{source_ref}} destination {{destination_ref}}", readOnly: true, parameterNames: ["source_ref", "destination_ref"] },
  NETWORK_WIRELESS_CLIENT_SUMMARY: { id: "NETWORK_WIRELESS_CLIENT_SUMMARY", persona: "NETWORK", command: "show wireless client mac-address {{client_ref}} detail", readOnly: true, parameterNames: ["client_ref"] },
  NETWORK_SDWAN_CONTROL_SUMMARY: { id: "NETWORK_SDWAN_CONTROL_SUMMARY", persona: "NETWORK", command: "show sdwan control connections", readOnly: true, parameterNames: [] },
  WINDOWS_SERVICE_STATUS: { id: "WINDOWS_SERVICE_STATUS", persona: "WINDOWS", command: "Get-Service -Name {{service_name}} | Select-Object Name,Status,StartType", readOnly: true, parameterNames: ["service_name"] },
  WINDOWS_RECENT_SYSTEM_ERRORS: { id: "WINDOWS_RECENT_SYSTEM_ERRORS", persona: "WINDOWS", command: "Get-WinEvent -FilterHashtable @{LogName='System';Level=2} -MaxEvents 25", readOnly: true, parameterNames: [] },
  WINDOWS_NETWORK_VALIDATION: { id: "WINDOWS_NETWORK_VALIDATION", persona: "WINDOWS", command: "Get-NetIPConfiguration; Get-NetRoute -AddressFamily IPv4 | Sort-Object RouteMetric | Select-Object -First 20; Test-NetConnection -ComputerName {{destination_ref}} -InformationLevel Detailed", readOnly: true, parameterNames: ["destination_ref"] },
  WINDOWS_DNS_VALIDATION: { id: "WINDOWS_DNS_VALIDATION", persona: "WINDOWS", command: "Resolve-DnsName -Name {{destination_ref}} -DnsOnly; Get-DnsClientServerAddress -AddressFamily IPv4", readOnly: true, parameterNames: ["destination_ref"] },
  WINDOWS_KERBEROS_VALIDATION: { id: "WINDOWS_KERBEROS_VALIDATION", persona: "WINDOWS", command: "w32tm /query /status; klist; Test-ComputerSecureChannel -Verbose", readOnly: true, parameterNames: [] },
  WINDOWS_IIS_VALIDATION: { id: "WINDOWS_IIS_VALIDATION", persona: "WINDOWS", command: "Get-WebAppPoolState -Name {{service_name}}; Get-Website | Select-Object Name,State,Bindings", readOnly: true, parameterNames: ["service_name"] },
  KUBERNETES_WORKLOAD_STATUS: { id: "KUBERNETES_WORKLOAD_STATUS", persona: "CLOUDOPS_DEVOPS", command: "kubectl get pods -n {{namespace}} -o wide", readOnly: true, parameterNames: ["namespace"] },
  KUBERNETES_RECENT_EVENTS: { id: "KUBERNETES_RECENT_EVENTS", persona: "CLOUDOPS_DEVOPS", command: "kubectl get events -n {{namespace}} --sort-by=.lastTimestamp", readOnly: true, parameterNames: ["namespace"] },
  SECURITY_AUTH_FAILURES: { id: "SECURITY_AUTH_FAILURES", persona: "SECURITY", command: "security-playbook auth-failures --window 15m", readOnly: true, parameterNames: [] },
  SECURITY_THREAT_INDICATORS: { id: "SECURITY_THREAT_INDICATORS", persona: "SECURITY", command: "security-playbook threat-indicators --window 15m", readOnly: true, parameterNames: [] }
};

const sensitive = /(password|passwd|secret|token|credential|private[_ -]?key|authorization)\s*[:=]\s*([^\s,;]+)/gi;
const privateIpv4 = /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})\b/g;

export function redactOperationalText(value: unknown, maxLength = 3_000, preserveUnicode = false): string {
  return String(value ?? "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, "[REDACTED PRIVATE KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/=-]+/gi, "Bearer [REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/(["']?(?:password|passwd|secret|token|credential|private[_ -]?key|authorization)["']?\s*[:=]\s*)("[^"]*"|'[^']*')/gi, "$1[REDACTED]")
    .replace(sensitive, (_match, key) => `${key}=[REDACTED]`)
    .replace(privateIpv4, "[PRIVATE_IP_REDACTED]")
    .replace(/\b(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):[0-9a-f:]+(?:%[a-z0-9]+)?/gi, "[PRIVATE_IP_REDACTED]")
    .replace(preserveUnicode ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g : /[^\x09\x0A\x0D\x20-\x7E]/g, preserveUnicode ? "" : "?")
    .slice(0, maxLength);
}

function boundedId(value: unknown, field: string) {
  const result = String(value || "").trim();
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(result) || redactOperationalText(result, 160) !== result) throw new Error(`${field} is missing or contains unsupported characters.`);
  return result;
}

export function selectEngineerPersona(incident: Pick<ServiceNowIncident, "category" | "shortDescription" | "metadata">): EngineerPersona {
  const ciType = String(incident.metadata?.ciClass || incident.metadata?.ciType || "").toLowerCase();
  if (/security|firewall/.test(ciType)) return "SECURITY";
  if (/database|postgres|oracle|mssql/.test(ciType)) return "DATABASE";
  if (/middleware|queue|kafka|rabbitmq/.test(ciType)) return 'MIDDLEWARE';
  if (/devops/.test(ciType)) return 'DEVOPS';
  if (/windows|win_server/.test(ciType)) return "WINDOWS";
  if (/linux|unix/.test(ciType)) return "LINUX";
  if (/kubernetes|container/.test(ciType)) return "DEVOPS";
  if (/cloud|azure|aws|gcp/.test(ciType)) return "CLOUDOPS";
  if (/network|router|switch|wireless/.test(ciType)) return "NETWORK";
  const value = `${incident.category} ${incident.shortDescription} ${JSON.stringify(incident.metadata || {})}`.toLowerCase();
  if (/security|threat|malware|ransomware|cve|vulnerab|unauthori[sz]ed|intrusion|ddos|brute.force/.test(value)) return "SECURITY";
  if (/windows|active directory|powershell|iis|winrm|kerberos/.test(value)) return "WINDOWS";
  if (/linux|systemd|ubuntu|rhel|unix/.test(value)) return "LINUX";
  if (/devops|pipeline|jenkins|gitops/.test(value)) return "DEVOPS";
  if (["Wireless", "SDWAN"].includes(incident.category)) return "NETWORK";
  if (/kubernetes|k8s|container|docker|pod|deployment/.test(value)) return "DEVOPS";
  if (/cloud|azure|\baws\b|\bgcp\b/.test(value)) return "CLOUDOPS";
  return "NETWORK";
}

export function correlateCmdbTarget(incident: ServiceNowIncident): string {
  const candidates = [incident.metadata?.cmdbSysId, incident.metadata?.cmdb_ci, incident.cmdbItem];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (value && !/^(unknown|unknown-ci|unmapped)$/i.test(value) && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) && redactOperationalText(value, 160) === value) return value;
    privateIpv4.lastIndex = 0;
  }
  throw new Error("Incident is not correlated to one valid CMDB device identifier.");
}

export interface ProxyCommandRequest {
  incidentId: string;
  workflowId: string;
  deviceId: string;
  persona: EngineerPersona;
  templateId: DiagnosticTemplateId;
  parameters: Record<string, string>;
  correlationId: string;
}

export interface ProxyCommandResponse {
  executionId: string;
  status: "SUCCEEDED" | "FAILED" | "SIMULATED";
  output: string;
  observedAt: string;
  proxyAuditId?: string;
}

export interface CommandProxy {
  executeCommand(request: ProxyCommandRequest): Promise<ProxyCommandResponse>;
  exchangeEvidence?(request: AgentEvidenceMessage): Promise<AgentEvidenceReceipt>;
}

export interface AgentEvidenceMessage {
  incidentId: string;
  workflowId: string;
  correlationId: string;
  sender: EngineerPersona;
  recipient: EngineerPersona;
  evidenceJson: string;
  candidateActionsJson: string;
}
export interface AgentEvidenceReceipt {
  incidentId: string;
  workflowId: string;
  correlationId: string;
  recipient: EngineerPersona;
  status: "ACKNOWLEDGED" | "SIMULATED";
}

export class GrpcCommandProxy implements CommandProxy {
  close() { this.client.close(); }
  private client: grpc.Client & { executeCommand(request: ProxyCommandRequest, metadata: grpc.Metadata, options: grpc.CallOptions, callback: (error: grpc.ServiceError | null, response: ProxyCommandResponse) => void): grpc.ClientUnaryCall };
  constructor(private readonly secrets: SecretProvider, endpoint = process.env.COMMAND_PROXY_GRPC_ENDPOINT || "") {
    if (!endpoint) throw new Error("COMMAND_PROXY_GRPC_ENDPOINT is not configured.");
    const credentials = process.env.OPERATING_MODE !== "LIVE"
      ? grpc.credentials.createInsecure()
      : grpc.credentials.createSsl(
          readFileSync(String(process.env.COMMAND_PROXY_CA_FILE)),
          readFileSync(String(process.env.COMMAND_PROXY_CLIENT_KEY_FILE)),
          readFileSync(String(process.env.COMMAND_PROXY_CLIENT_CERT_FILE))
        );
    const definition = protoLoader.loadSync(path.resolve(process.cwd(), "proto", "command_proxy.proto"), {
      keepCase: false,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true
    });
    const service = (grpc.loadPackageDefinition(definition) as any).cloudzero.commandproxy.v1.CommandProxy;
    this.client = new service(endpoint, credentials, {
      "grpc.max_receive_message_length": 1024 * 1024,
      "grpc.max_send_message_length": 64 * 1024
    });
  }

  async executeCommand(request: ProxyCommandRequest): Promise<ProxyCommandResponse> {
    const token = await this.secrets.get("COMMAND_PROXY_ACCESS_TOKEN");
    if (!token) throw new Error("Command proxy access token is unavailable.");
    const metadata = new grpc.Metadata();
    metadata.set("authorization", `Bearer ${token}`);
    metadata.set("x-correlation-id", request.correlationId);
    const deadline = new Date(Date.now() + Math.min(Math.max(Number(process.env.COMMAND_PROXY_TIMEOUT_MS || 15_000), 1_000), 30_000));
    return new Promise((resolve, reject) => {
      this.client.executeCommand(
        request,
        metadata,
        { deadline },
        (error, response) => error ? reject(new Error(`Command proxy failed: ${error.code}`)) : resolve(response as ProxyCommandResponse)
      );
    });
  }

  async exchangeEvidence(request: AgentEvidenceMessage): Promise<AgentEvidenceReceipt> {
    const token = await this.secrets.get("COMMAND_PROXY_ACCESS_TOKEN");
    if (!token) throw new Error("Command proxy access token is unavailable.");
    const metadata = new grpc.Metadata();
    metadata.set("authorization", `Bearer ${token}`);
    metadata.set("x-correlation-id", request.correlationId);
    return new Promise((resolve, reject) => {
      (this.client as any).exchangeEvidence(request, metadata, { deadline: new Date(Date.now() + 15_000) },
        (error: grpc.ServiceError | null, response: AgentEvidenceReceipt) => error ? reject(new Error(`Agent exchange failed: ${error.code}`)) : resolve(response));
    });
  }
}

export class SimulationCommandProxy implements CommandProxy {
  async exchangeEvidence(request: AgentEvidenceMessage): Promise<AgentEvidenceReceipt> {
    return { incidentId: request.incidentId, workflowId: request.workflowId, correlationId: request.correlationId, recipient: request.recipient, status: "SIMULATED" };
  }
  async executeCommand(request: ProxyCommandRequest): Promise<ProxyCommandResponse> {
    return {
      executionId: crypto.randomUUID(),
      status: "SIMULATED",
      output: `Validated simulated response for ${request.templateId}; no device connection was made.`,
      observedAt: new Date().toISOString(),
      proxyAuditId: `sim-${request.correlationId}`
    };
  }
}

function renderCommand(template: DiagnosticTemplate, parameters: Record<string, string>) {
  let command = template.command;
  for (const name of template.parameterNames) {
    const value = String(parameters[name] || "").trim();
    if (!/^[A-Za-z0-9_./:-]{1,80}$/.test(value)) throw new Error(`Parameter ${name} is missing or invalid.`);
    command = command.replaceAll(`{{${name}}}`, value);
  }
  const unexpected = Object.keys(parameters).filter(name => !template.parameterNames.includes(name));
  if (unexpected.length) throw new Error(`Unexpected command parameters: ${unexpected.join(", ")}.`);
  return command;
}

export interface DiagnosticResult {
  persona: EngineerPersona;
  templateId: DiagnosticTemplateId;
  commandDisplay: string;
  response: Omit<ProxyCommandResponse, "output"> & { output: string };
  evidence: IncidentEvidence;
  workNote: string;
}

export interface DiagnosticPlanItem {
  templateId: DiagnosticTemplateId;
  objective: string;
  parameters: Record<string, string>;
}

const safeReference = (value: unknown) => /^[A-Za-z0-9_.-]{1,80}$/.test(String(value || "")) ? String(value) : "affected-service";
const safeInterface = (value: unknown) => /^[A-Za-z0-9_./:-]{1,80}$/.test(String(value || "")) ? String(value) : "affected-access-port";

/** Deterministic, allowlisted checks. Models may interpret results but never invent commands. */
export function diagnosticPlanFor(persona: EngineerPersona, incident: ServiceNowIncident): DiagnosticPlanItem[] {
  // Select checks from the reported symptom and structured incident fields. A generic
  // asset name such as "router-01" or "windows-host" is a target, not a diagnosis.
  const metadata = incident.metadata || {};
  const structuredContext = [metadata.description, metadata.ciClass, metadata.ciType, metadata.platform, metadata.serviceName, metadata.service_name, metadata.symptom]
    .filter(value => typeof value === "string").join(" ");
  const context = `${incident.category} ${incident.shortDescription} ${structuredContext}`.toLowerCase();
  const symptom = `${incident.shortDescription} ${metadata.description || ""} ${metadata.symptom || ""}`.toLowerCase();
  const destination = safeReference(incident.metadata?.destinationRef || incident.metadata?.serviceName || incident.metadata?.service_name || "affected-service");
  if (persona === "NETWORK") {
    const plan: DiagnosticPlanItem[] = [];
    if (/vlan|switchport|access segment/.test(context)) plan.push({ templateId: "NETWORK_ACCESS_VLAN", objective: "Compare the affected access port VLAN with the incident's assigned application segment.", parameters: { interface_ref: safeInterface(incident.metadata?.interfaceRef || "affected-access-port") } });
    if (/mtu|large packet|fragment|df.bit/.test(context)) plan.push({ templateId: "NETWORK_PATH_MTU", objective: "Test whether the reported packet size traverses the path without fragmentation.", parameters: { destination_ref: destination, packet_size: safeReference(incident.metadata?.packetSize || "1500") } });
    if (/firewall|acl|policy|session/.test(context)) plan.push({ templateId: "NETWORK_FIREWALL_SESSION_SUMMARY", objective: "Validate whether the firewall created or denied the reported flow.", parameters: { source_ref: safeReference(incident.metadata?.sourceRef || "affected-client"), destination_ref: destination } });
    if (/wireless|wlc|access point|\bap\b|roam/.test(context)) plan.push({ templateId: "NETWORK_WIRELESS_CLIENT_SUMMARY", objective: "Validate client association, authentication, policy and roaming state.", parameters: { client_ref: safeReference(incident.metadata?.clientRef || "affected-client") } });
    if (/sd.?wan|control connection|tunnel/.test(context)) plan.push({ templateId: "NETWORK_SDWAN_CONTROL_SUMMARY", objective: "Validate SD-WAN controller and control-connection state.", parameters: {} });
    if (/\bbgp\b|route flap|neighbor reset|prefix withdraw/.test(context)) plan.push({ templateId: "NETWORK_BGP_SUMMARY", objective: "Validate routing-neighbor establishment and received state.", parameters: {} });
    if (/switch|layer.?2|stp/.test(symptom) && !/vlan|firewall/.test(context)) plan.push({ templateId: "NETWORK_NEIGHBOR_SUMMARY", objective: "Validate adjacent-device identity and attachment.", parameters: {} });
    if (!plan.length || /interface|link|port down/.test(context)) plan.unshift({ templateId: "NETWORK_INTERFACE_SUMMARY", objective: "Validate administrative and operational interface state relevant to the reported symptom.", parameters: {} });
    if (/reach|connect|path|route|traffic/.test(context) && !/vlan|mtu|wireless|roam/.test(context)) plan.push({ templateId: "NETWORK_ROUTE_SUMMARY", objective: "Validate that the forwarding table contains a usable path to the affected service.", parameters: {} });
    return plan.slice(0, 4);
  }
  if (persona === "WINDOWS") {
    const plan: DiagnosticPlanItem[] = [];
    if (/dns|name resolution|resolver/.test(context)) {
      plan.push({ templateId: "WINDOWS_SERVICE_STATUS", objective: "Validate the DNS Server service state associated with the reported resolution failure.", parameters: { service_name: "DNS" } });
      plan.push({ templateId: "WINDOWS_DNS_VALIDATION", objective: "Validate resolver configuration and name resolution from the affected host.", parameters: { destination_ref: destination } });
    }
    if (/kerberos|clock drift|time sync|domain sign.in|authentication/.test(context)) plan.push({ templateId: "WINDOWS_KERBEROS_VALIDATION", objective: "Correlate Windows time synchronization, Kerberos tickets and domain secure-channel state.", parameters: {} });
    if (/\biis\b|application pool|http 503|website/.test(context)) plan.push({ templateId: "WINDOWS_IIS_VALIDATION", objective: "Validate the affected IIS application pool and website state.", parameters: { service_name: safeReference(incident.metadata?.serviceName || "affected-app-pool") } });
    if (/vlan|network|connect|reach|route|gateway|dependency failure|outside the host/.test(context)) plan.push({ templateId: "WINDOWS_NETWORK_VALIDATION", objective: "Test host addressing, route selection and application reachability to correlate with the network finding.", parameters: { destination_ref: destination } });
    if (/service (?:failed|stopped|crash)|patch|deployment|operating system|system error/.test(context) && !/dns|iis|application pool/.test(context)) plan.push({ templateId: "WINDOWS_RECENT_SYSTEM_ERRORS", objective: "Correlate timestamped Windows errors with the incident onset and reported service.", parameters: {} });
    if (!plan.length) plan.push({ templateId: "WINDOWS_RECENT_SYSTEM_ERRORS", objective: "Inspect timestamped Windows errors because the incident lacks a more specific host symptom.", parameters: {} });
    return plan.slice(0, 3);
  }
  const defaults: Partial<Record<EngineerPersona, DiagnosticPlanItem[]>> = {
    LINUX: [
      { templateId: "LINUX_SERVICE_FAILURES", objective: "Validate failed services before attributing the incident to the host.", parameters: {} },
      { templateId: "LINUX_RECENT_ERRORS", objective: "Validate timestamped host errors near incident onset.", parameters: {} },
      { templateId: "LINUX_NETWORK_VALIDATION", objective: "Validate host addressing, routes, name resolution and destination TCP reachability.", parameters: { destination_ref: destination, destination_port: safeReference(incident.metadata?.destinationPort || "443") } }
    ],
    DEVOPS: [{ templateId: "DEVOPS_RECENT_EVENTS", objective: "Validate recent workload events.", parameters: { namespace: safeReference(incident.metadata?.namespace) } }],
    CLOUDOPS_DEVOPS: [{ templateId: "KUBERNETES_RECENT_EVENTS", objective: "Validate recent orchestration events.", parameters: { namespace: safeReference(incident.metadata?.namespace) } }],
    SECURITY: [{ templateId: "SECURITY_THREAT_INDICATORS", objective: "Validate relevant threat indicators within the incident window.", parameters: {} }],
    CLOUDOPS: [{ templateId: "CLOUD_RESOURCE_HEALTH", objective: "Validate provider resource health.", parameters: {} }],
    DATABASE: [{ templateId: "DATABASE_CONNECTION_HEALTH", objective: "Validate database connection health.", parameters: {} }],
    MIDDLEWARE: [{ templateId: "MIDDLEWARE_QUEUE_HEALTH", objective: "Validate queue and consumer health.", parameters: {} }]
  };
  return defaults[persona] || [];
}

export class EngineeringIncidentOrchestrator {
  constructor(private readonly proxy: CommandProxy) {}

  async diagnose(input: {
    incident: IncidentAggregate;
    workflowId: string;
    templateId: DiagnosticTemplateId;
    parameters?: Record<string, string>;
    actorId: string;
    objective?: string;
    collaboratingPersona?: EngineerPersona;
    relatedTarget?: ServiceNowIncident;
  }): Promise<DiagnosticResult> {
    const incidentId = boundedId(input.incident.incidentId, "incidentId");
    const workflowId = boundedId(input.workflowId, "workflowId");
    if (!input.incident.workflows.some(item => item.id === workflowId && item.incidentId === incidentId)) {
      throw new Error("Workflow is not bound to the requested incident.");
    }
    if (!input.incident.serviceNowIncident) throw new Error("A ServiceNow incident is required for engineering diagnostics.");
    const plan = collaborationPlan(input.incident.serviceNowIncident);
    const persona = input.collaboratingPersona || selectEngineerPersona(input.incident.serviceNowIncident);
    if (!plan.participants.includes(persona)) throw new Error("Persona is not bound to this incident collaboration.");
    const template = templates[input.templateId];
    if (!template || template.persona !== persona || !template.readOnly) throw new Error("Diagnostic template is not allowlisted for the selected persona.");
    // A Windows/Linux collaborator must not send host commands to the incident's router CI.
    // Cross-CI targets require a separately correlated incident; ticket prose is not a target binding.
    const primaryPersona = selectEngineerPersona(input.incident.serviceNowIncident);
    let targetIncident = input.incident.serviceNowIncident;
    if (input.relatedTarget) {
      const change = String(targetIncident.metadata?.relatedChange || "").trim();
      if (!change || change !== input.relatedTarget.metadata?.relatedChange || selectEngineerPersona(input.relatedTarget) !== persona) {
        throw new Error("Related diagnostic target lacks an exact shared change and matching persona.");
      }
      targetIncident = input.relatedTarget;
    }
    if ((persona === "WINDOWS" || persona === "LINUX" || persona === "DATABASE") && persona !== primaryPersona && !input.relatedTarget) {
      throw new Error("Collaborating host diagnostics require a correlated incident for that host; no cross-CI target is verified.");
    }
    const deviceId = correlateCmdbTarget(targetIncident);
    const parameters = input.parameters || {};
    const commandDisplay = renderCommand(template, parameters);
    const correlationId = crypto.randomUUID();
    const received = await this.proxy.executeCommand({ incidentId, workflowId, deviceId, persona, templateId: template.id, parameters, correlationId });
    if (!["SUCCEEDED", "FAILED", "SIMULATED"].includes(received.status)) throw new Error("Unverified diagnostic response status.");
    const raw: ProxyCommandResponse = { executionId: boundedId(redactOperationalText(received.executionId, 160), "executionId"),
      proxyAuditId: redactOperationalText(received.proxyAuditId, 160), status: received.status,
      output: received.output, observedAt: received.observedAt };
    const output = redactOperationalText(raw.output);
    const observedAt = Number.isFinite(Date.parse(raw.observedAt)) ? new Date(raw.observedAt).toISOString() : new Date().toISOString();
    const evidence: IncidentEvidence = {
      id: `diagnostic-${raw.executionId}`,
      incidentId,
      workflowId,
      source: "gRPC Command Proxy",
      summary: `${template.id}: ${output.slice(0, 500)}`,
      observedAt,
      payload: { executionId: redactOperationalText(raw.executionId, 160), status: raw.status, proxyAuditId: redactOperationalText(raw.proxyAuditId, 160), persona, templateId: template.id, objective: redactOperationalText(input.objective, 300), commandDisplay, output, targetIncidentId: targetIncident.id, targetCiId: deviceId, relatedChange: targetIncident.metadata?.relatedChange },
      integrityHash: crypto.createHash("sha256").update(JSON.stringify({ incidentId, workflowId, deviceId, templateId: template.id, output, observedAt })).digest("hex")
    };
    const workNote = redactOperationalText([
      `[CloudZero Digital Twin diagnostic] Incident=${incidentId} Workflow=${workflowId} Persona=${persona}`,
      `CMDB target=[REDACTED DEVICE ID] Template=${template.id}`,
      `Command executed=${commandDisplay}`,
      `Status=${raw.status} Execution=${raw.executionId}`,
      `Observed output=${output}`,
      "Assessment=Diagnostic evidence collected; no causation is asserted without corroborating telemetry.",
      "Next step=Correlate this evidence with monitoring/security signals and use an approval-bound runbook for any remediation."
    ].join("\n"), 4_000);
    return { persona, templateId: template.id, commandDisplay, response: { ...raw, output, observedAt }, evidence, workNote };
  }
}

export function collaborationPlan(incident: ServiceNowIncident) {
  const initialPersona = selectEngineerPersona(incident);
  const demo = incident.id?.startsWith('DEMO-') && incident.metadata?.source === 'A2A_DEMO_DATABASE' ? demoScenarios.find(s=>s.id===incident.metadata?.demoScenarioId) : undefined;
  if(demo) return {initialPersona,participants:[...demo.roles],responsiblePersona:demo.owner,closurePersona:demo.owner};
  // Transport/storage provenance is not evidence that a database or cloud team is affected.
  const { source, dataOrigin, demoSessionId, ...routingMetadata } = incident.metadata || {};
  const context = `${incident.shortDescription} ${incident.cmdbName} ${JSON.stringify(routingMetadata)}`.toLowerCase();
  const participants = new Set<EngineerPersona>([initialPersona]);
  if (/database|postgres|oracle|mssql/.test(context)) participants.add("DATABASE");
  if (/linux|unix|ubuntu|rhel|systemd/.test(context)) participants.add("LINUX");
  if (/devops|pipeline|jenkins|gitops|kubernetes|docker/.test(context)) participants.add("DEVOPS");
  if (/cloudops/.test(context)) participants.add("CLOUDOPS");
  if (/network|router|switch|sd.?wan|\bbgp\b|\bise\b|wireless/.test(context)) participants.add("NETWORK");
  if (/azure|\baws\b|\bgcp\b|cloud/.test(context)) participants.add("CLOUDOPS");
  if (/certificate|\bpki\b|\btls\b|security|malware|threat/.test(context)) participants.add("SECURITY");
  if (/windows|active directory|powershell|\biis\b/.test(context)) participants.add("WINDOWS");
  const responsiblePersona: EngineerPersona = /azure/.test(context) && /\bise\b/.test(context)
    ? "CLOUDOPS"
    : /certificate|\bpki\b/.test(context) && participants.has("NETWORK") ? "NETWORK" : initialPersona;
  participants.add(responsiblePersona);
  return { initialPersona, participants: [...participants], responsiblePersona, closurePersona: responsiblePersona };
}

export function diagnosticTemplatesFor(persona: EngineerPersona) {
  return Object.values(templates).filter(item => item.persona === persona).map(({ command: _command, ...safe }) => safe);
}
