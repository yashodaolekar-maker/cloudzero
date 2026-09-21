import crypto from "node:crypto";
import type { IncidentEvidence, ServiceNowIncident } from "../types.ts";
import { redactOperationalText, selectEngineerPersona, type EngineerPersona } from "./engineering-orchestrator.ts";

export interface ExternalAgentConfig {
  id: string;
  name: string;
  endpoint: string;
  domains: EngineerPersona[];
  capabilities: string[];
  enabled: boolean;
  timeoutMs: number;
  hasApiKey: boolean;
  status: "UNTESTED" | "CONNECTED" | "FAILED";
  lastCheckedAt?: string;
  lastInvokedAt?: string;
  lastLatencyMs?: number;
  lastError?: string;
}

interface ExternalAgentReply {
  status: "EVIDENCE_COLLECTED" | "ABSTAINED";
  summary: string;
  confidence: number;
  checks: Array<{ command?: string; purpose: string; result: string; expected?: string; outcome: "PASSED" | "FAILED" | "INCONCLUSIVE" }>;
  hypotheses?: Array<{ statement: string; supportingEvidence?: string[]; contradictingEvidence?: string[] }>;
  recommendedNextAgent?: string;
}

const supportedDomains = new Set<EngineerPersona>(["NETWORK", "WINDOWS", "LINUX", "DATABASE", "CLOUDOPS", "DEVOPS", "MIDDLEWARE", "SECURITY"]);

export class ExternalAgentRegistry {
  private readonly configs = new Map<string, ExternalAgentConfig>();
  private readonly apiKeys = new Map<string, string>();

  list() { return [...this.configs.values()].map(item => ({ ...item, domains: [...item.domains], capabilities: [...item.capabilities] })); }

  upsert(input: Record<string, unknown>, allowLocalHttp: boolean) {
    const id = String(input.id || crypto.randomUUID()).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 80);
    const name = redactOperationalText(input.name, 120).trim();
    const endpoint = String(input.endpoint || "").trim();
    const domains = Array.isArray(input.domains) ? input.domains.map(String).filter((value): value is EngineerPersona => supportedDomains.has(value as EngineerPersona)) : [];
    const capabilities = Array.isArray(input.capabilities) ? input.capabilities.map(value => redactOperationalText(value, 80).trim().toLowerCase()).filter(Boolean).slice(0, 20) : [];
    if (!id || !name || !endpoint || !domains.length || !capabilities.length) throw new Error("Name, endpoint, at least one domain, and at least one capability are required.");
    const parsed = new URL(endpoint);
    const local = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname.toLowerCase());
    if (parsed.protocol !== "https:" && !(allowLocalHttp && local && parsed.protocol === "http:")) throw new Error("External agents require HTTPS; local simulation may use an HTTP loopback endpoint.");
    if (!local && /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(parsed.hostname)) throw new Error("Private network endpoints are not accepted by this connector.");
    const previous = this.configs.get(id);
    const apiKey = String(input.apiKey || "").trim();
    if (apiKey) this.apiKeys.set(id, apiKey);
    const config: ExternalAgentConfig = {
      id, name, endpoint: parsed.toString(), domains: [...new Set(domains)], capabilities: [...new Set(capabilities)],
      enabled: input.enabled !== false, timeoutMs: Math.max(2_000, Math.min(Number(input.timeoutMs) || 20_000, 60_000)),
      hasApiKey: Boolean(apiKey || this.apiKeys.has(id)), status: previous?.status || "UNTESTED",
      lastCheckedAt: previous?.lastCheckedAt, lastInvokedAt: previous?.lastInvokedAt, lastLatencyMs: previous?.lastLatencyMs, lastError: previous?.lastError
    };
    if (!config.hasApiKey) throw new Error("An API key is required when registering a new external agent.");
    this.configs.set(id, config);
    return { ...config };
  }

  remove(id: string) { this.apiKeys.delete(id); return this.configs.delete(id); }

  private async call(config: ExternalAgentConfig, body: Record<string, unknown>) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const started = Date.now();
    try {
      const response = await fetch(config.endpoint, { method: "POST", signal: controller.signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKeys.get(config.id) || ""}`, "x-cloudzero-agent-id": config.id },
        body: JSON.stringify(body) });
      if (!response.ok) throw new Error(`External agent returned HTTP ${response.status}.`);
      const data = await response.json();
      config.status = "CONNECTED"; config.lastError = undefined; config.lastLatencyMs = Date.now() - started; config.lastCheckedAt = new Date().toISOString();
      return data;
    } catch (error) {
      config.status = "FAILED"; config.lastError = error instanceof Error ? error.message.slice(0, 240) : "External agent request failed.";
      config.lastLatencyMs = Date.now() - started; config.lastCheckedAt = new Date().toISOString();
      throw error;
    } finally { clearTimeout(timer); }
  }

  async test(id: string) {
    const config = this.configs.get(id); if (!config) throw new Error("External agent not found.");
    await this.call(config, { kind: "CONNECTION_TEST", requestId: crypto.randomUUID(), constraints: { mode: "READ_ONLY" } });
    return { ...config };
  }

  async investigate(incident: ServiceNowIncident, workflowId: string): Promise<Array<{ agent: ExternalAgentConfig; evidence: IncidentEvidence }>> {
    const persona = selectEngineerPersona(incident);
    const agents = [...this.configs.values()].filter(item => item.enabled && item.status !== "FAILED" && item.domains.includes(persona));
    const output: Array<{ agent: ExternalAgentConfig; evidence: IncidentEvidence }> = [];
    for (const agent of agents) {
      const requestId = crypto.randomUUID();
      const raw = await this.call(agent, { kind: "INVESTIGATION_REQUEST", requestId, incidentId: incident.id, workflowId,
        requestedCapabilities: agent.capabilities, target: { resourceId: incident.cmdbItem, type: incident.category },
        incident: { summary: redactOperationalText(incident.shortDescription, 600), category: incident.category },
        constraints: { mode: "READ_ONLY", commandsRequireApproval: true, redactSensitiveData: true } });
      const reply = raw as ExternalAgentReply;
      if (!["EVIDENCE_COLLECTED", "ABSTAINED"].includes(reply?.status) || typeof reply.summary !== "string" || !Number.isFinite(reply.confidence) || reply.confidence < 0 || reply.confidence > 1 || !Array.isArray(reply.checks)) throw new Error(`${agent.name} returned an invalid evidence contract.`);
      const checks = reply.checks.slice(0, 20).map(check => ({ command: redactOperationalText(check.command, 500), purpose: redactOperationalText(check.purpose, 300), result: redactOperationalText(check.result, 800), expected: redactOperationalText(check.expected, 300), outcome: check.outcome }));
      if (checks.some(check => !check.purpose || !check.result || !["PASSED", "FAILED", "INCONCLUSIVE"].includes(check.outcome))) throw new Error(`${agent.name} returned malformed validation checks.`);
      agent.lastInvokedAt = new Date().toISOString();
      const canonical = JSON.stringify({ requestId, incidentId: incident.id, workflowId, agentId: agent.id, summary: reply.summary, checks });
      output.push({ agent: { ...agent }, evidence: { id: `external-${requestId}`, incidentId: incident.id, workflowId, source: `External Agent: ${agent.name}`,
        summary: redactOperationalText(reply.summary, 800), confidenceScore: reply.confidence * 100, observedAt: new Date().toISOString(),
        payload: { persona, agentId: agent.id, capabilities: agent.capabilities, status: reply.status, checks, hypotheses: reply.hypotheses, recommendedNextAgent: reply.recommendedNextAgent, requestId, dataOrigin: "EXTERNAL_AUTHENTICATED_AGENT" },
        integrityHash: crypto.createHash("sha256").update(canonical).digest("hex") } });
    }
    return output;
  }
}
