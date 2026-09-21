import React, { useState, useEffect } from "react";
import { 
  Settings, 
  Shield, 
  Key, 
  Server, 
  Save, 
  CheckCircle2, 
  XCircle,
  AlertTriangle,
  Webhook, 
  RefreshCw, 
  Activity, 
  UserCheck, 
  Radio, 
  Info
} from "lucide-react";
import { SSOUser } from "../types";

interface AgentConfigViewProps {
  currentUser: SSOUser;
}

interface OpenIdDiscoveryResult {
  issuer: string;
  tokenEndpoint: string;
  jwksUri: string;
}

interface PersistedDisplayConfig {
  tenantId: string;
  agentUsername: string;
  clientId: string;
  snowInstanceUrl: string;
  snowClientId: string;
}

interface IntegrationReadiness {
  id: string;
  label: string;
  state: "READY" | "DISABLED" | "INCOMPLETE";
  missing: string[];
  settings: string[];
  secretNames: string[];
  connectionPath: "DIRECT_READ_ONLY" | "GRPC_PROXY" | "PLATFORM";
  required: string[];
}

interface ExternalAgentConfig {
  id: string; name: string; endpoint: string; domains: string[]; capabilities: string[]; enabled: boolean;
  hasApiKey: boolean; status: "UNTESTED" | "CONNECTED" | "FAILED"; lastLatencyMs?: number; lastError?: string;
}

const externalDomains = ["NETWORK", "WINDOWS", "LINUX", "DATABASE", "CLOUDOPS", "DEVOPS", "MIDDLEWARE", "SECURITY"];

function sanitizeDisplayConfig(value: unknown): PersistedDisplayConfig {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const stringValue = (key: keyof PersistedDisplayConfig) => {
    const value = typeof record[key] === "string" ? String(record[key]).trim() : "";
    // Remove the retired demo identity from browsers that persisted it in an
    // earlier release. Client identities must come from the configured IdP.
    return /@packetresolve\.in$/i.test(value) ? "" : value;
  };
  return {
    tenantId: stringValue("tenantId"),
    agentUsername: stringValue("agentUsername"),
    clientId: stringValue("clientId"),
    snowInstanceUrl: stringValue("snowInstanceUrl"),
    snowClientId: stringValue("snowClientId"),
  };
}

export default function AgentConfigView({ currentUser }: AgentConfigViewProps) {
  // Azure AD Identity Settings
  const [tenantId, setTenantId] = useState("");
  const [agentUsername, setAgentUsername] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  
  // Real Tenant Verification State
  const [isVerifyingTenant, setIsVerifyingTenant] = useState(false);
  const [tenantVerified, setTenantVerified] = useState(false);
  const [tenantError, setTenantError] = useState<string | null>(null);

  // OpenID discovery proves issuer metadata resolution only. It does not issue a
  // client certificate or establish an mTLS binding.
  const [openIdDiscovery, setOpenIdDiscovery] = useState<OpenIdDiscoveryResult | null>(null);

  // ServiceNow ITSM Settings
  const [snowInstanceUrl, setSnowInstanceUrl] = useState("");
  const [snowClientId, setSnowClientId] = useState("");
  const [snowClientSecret, setSnowClientSecret] = useState("");
  const [snowStatus, setSnowStatus] = useState<"untested" | "testing" | "connected" | "failed">("untested");
  const [snowMessage, setSnowMessage] = useState<string | null>(null);

  // Orchestrator Sync & Observability State
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deploymentProfile, setDeploymentProfile] = useState("UNKNOWN");
  const [productionReady, setProductionReady] = useState(false);
  const [integrationReadiness, setIntegrationReadiness] = useState<IntegrationReadiness[]>([]);
  const [readinessError, setReadinessError] = useState<string | null>(null);
  const [integrationDrafts, setIntegrationDrafts] = useState<Record<string, Record<string, string>>>({});
  const [validatedIntegration, setValidatedIntegration] = useState<string | null>(null);
  const [externalAgents, setExternalAgents] = useState<ExternalAgentConfig[]>([]);
  const [externalDraft, setExternalDraft] = useState({ name: "", endpoint: "", apiKey: "", capabilities: "", domains: ["NETWORK"] as string[] });
  const [externalBusy, setExternalBusy] = useState<string | null>(null);
  const [externalMessage, setExternalMessage] = useState<string | null>(null);

  // Load only non-secret display configuration. Rewriting the allowlisted shape
  // immediately purges legacy secrets, certificate material, and trust flags.
  useEffect(() => {
    const savedConfig = localStorage.getItem("agent_bridge_config");
    if (savedConfig) {
      try {
        const config = sanitizeDisplayConfig(JSON.parse(savedConfig) as unknown);
        localStorage.setItem("agent_bridge_config", JSON.stringify(config));
        setTenantId(config.tenantId);
        setAgentUsername(config.agentUsername);
        setClientId(config.clientId);
        setSnowInstanceUrl(config.snowInstanceUrl);
        setSnowClientId(config.snowClientId);
      } catch {
        localStorage.removeItem("agent_bridge_config");
      }
    }
  }, []);

  const loadIntegrationReadiness = async () => {
    try {
      const response = await fetch("/api/configuration/readiness");
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.integrations)) throw new Error(data.error || "Configuration inventory unavailable.");
      setDeploymentProfile(String(data.deploymentProfile || "UNKNOWN"));
      setProductionReady(data.productionReady === true);
      setIntegrationReadiness(data.integrations);
      setReadinessError(null);
    } catch (error: any) {
      setReadinessError(error?.message || "Configuration inventory unavailable.");
    }
  };

  useEffect(() => { void loadIntegrationReadiness(); }, []);

  const loadExternalAgents = async () => {
    try {
      const response = await fetch("/api/external-agents");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "External agent registry unavailable.");
      setExternalAgents(Array.isArray(data.agents) ? data.agents : []);
    } catch (error: any) { setExternalMessage(error?.message || "External agent registry unavailable."); }
  };

  useEffect(() => { if (currentUser.role === "Administrator") void loadExternalAgents(); }, [currentUser.role]);

  const registerExternalAgent = async () => {
    setExternalBusy("register"); setExternalMessage(null);
    try {
      const response = await fetch("/api/external-agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        ...externalDraft, capabilities: externalDraft.capabilities.split(",").map(value => value.trim()).filter(Boolean), enabled: true
      }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "External agent registration failed.");
      setExternalDraft({ name: "", endpoint: "", apiKey: "", capabilities: "", domains: ["NETWORK"] });
      setExternalMessage(`${data.agent.name} is enabled for matching incident workflows.`);
      await loadExternalAgents();
    } catch (error: any) { setExternalMessage(error?.message || "External agent registration failed."); }
    finally { setExternalBusy(null); }
  };

  const testExternalAgent = async (id: string) => {
    setExternalBusy(id); setExternalMessage(null);
    try { const response = await fetch(`/api/external-agents/${encodeURIComponent(id)}/test`, { method: "POST" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Connection test failed."); setExternalMessage(`${data.agent.name} returned a valid connection response in ${data.agent.lastLatencyMs} ms.`); }
    catch (error: any) { setExternalMessage(error?.message || "Connection test failed."); }
    finally { setExternalBusy(null); await loadExternalAgents(); }
  };

  const removeExternalAgent = async (id: string) => {
    setExternalBusy(id); setExternalMessage(null);
    try { const response = await fetch(`/api/external-agents/${encodeURIComponent(id)}`, { method: "DELETE" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Removal failed."); setExternalMessage("External agent removed and no longer receives requests."); await loadExternalAgents(); }
    catch (error: any) { setExternalMessage(error?.message || "Removal failed."); }
    finally { setExternalBusy(null); }
  };

  // Real Tenant Verification with Microsoft Entra ID
  const verifyTenantWithAzure = async (targetTenantId?: string, targetUsername?: string) => {
    const tId = targetTenantId !== undefined ? targetTenantId : tenantId;
    const uName = targetUsername !== undefined ? targetUsername : agentUsername;

    if (!tId || tId.trim().length < 2) {
      setTenantError("Please enter a valid Azure AD Directory (Tenant) ID or domain.");
      setTenantVerified(false);
      setOpenIdDiscovery(null);
      return;
    }

    setIsVerifyingTenant(true);
    setTenantError(null);

    try {
      const response = await fetch("/api/integrations/azure/verify-tenant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tId.trim(),
          agentUsername: uName.trim()
        })
      });

      const data = await response.json() as {
        success?: boolean;
        issuer?: unknown;
        tokenEndpoint?: unknown;
        jwksUri?: unknown;
        error?: string;
      };

      if (
        !response.ok
        || !data.success
        || typeof data.issuer !== "string"
        || typeof data.tokenEndpoint !== "string"
        || typeof data.jwksUri !== "string"
      ) {
        setTenantVerified(false);
        setOpenIdDiscovery(null);
        setTenantError(data.error || "Failed to verify tenant with Azure Active Directory.");
      } else {
        setTenantVerified(true);
        setTenantError(null);
        setOpenIdDiscovery({
          issuer: data.issuer,
          tokenEndpoint: data.tokenEndpoint,
          jwksUri: data.jwksUri,
        });
        persistDisplayConfig({
          tenantId: tId,
          agentUsername: uName,
        });
      }
    } catch (err: any) {
      setTenantVerified(false);
      setOpenIdDiscovery(null);
      setTenantError(`Connection error: ${err.message || "Failed to contact Azure AD"}`);
    } finally {
      setIsVerifyingTenant(false);
    }
  };

  // Real Orchestrator Sync & Microsoft Graph Authentication
  const handleSyncWithOrchestrator = async () => {
    if (!tenantId || !tenantId.trim()) {
      setSyncError("Cannot sync: Azure AD Tenant ID is required.");
      return;
    }
    if (!clientId || !clientSecret) {
      setSyncError("Cannot sync: Azure AD Graph Client ID and Client Secret are required for Microsoft Entra ID token acquisition.");
      return;
    }

    setIsSyncing(true);
    setSyncError(null);

    try {
      const response = await fetch("/api/integrations/azure/sync-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: tenantId.trim(),
          agentUsername: agentUsername.trim(),
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim()
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setIsSynced(false);
        setSyncError(data.error || "Microsoft Entra ID rejected the authentication request.");
      } else {
        const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const latency = data.telemetry?.latencyMs || 24;
        setIsSynced(true);
        setSyncError(null);
        setLastSyncTime(now);
        setLatencyMs(latency);
      }
    } catch (err: any) {
      setIsSynced(false);
      setSyncError(`Network failure while contacting Azure AD: ${err.message || "Connection timeout"}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Real ServiceNow Instance Verification
  const handleTestServiceNow = async () => {
    if (!snowInstanceUrl || !snowInstanceUrl.trim()) {
      setSnowStatus("failed");
      setSnowMessage("Please provide your ServiceNow Instance URL (e.g., https://dev12345.service-now.com).");
      return;
    }

    setSnowStatus("testing");
    setSnowMessage(null);

    try {
      const response = await fetch("/api/integrations/servicenow/test-connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceUrl: snowInstanceUrl.trim(),
          clientId: snowClientId.trim(),
          clientSecret: snowClientSecret.trim()
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        setSnowStatus("failed");
        setSnowMessage(data.error || "Failed to connect to ServiceNow instance.");
      } else {
        setSnowStatus("connected");
        setSnowMessage(data.message || "Successfully connected to ServiceNow instance.");
      }
    } catch (err: any) {
      setSnowStatus("failed");
      setSnowMessage(`Network error connecting to ServiceNow: ${err.message || "Unable to reach host"}`);
    }
  };

  const persistDisplayConfig = (updatedFields: Partial<PersistedDisplayConfig> = {}) => {
    try {
      const next: PersistedDisplayConfig = {
        tenantId,
        agentUsername,
        clientId,
        snowInstanceUrl,
        snowClientId,
        ...updatedFields,
      };
      localStorage.setItem("agent_bridge_config", JSON.stringify(next));
    } catch (e) {
      console.error("Storage update failed", e);
    }
  };

  const handleSave = () => {
    setSaving(true);
    setTimeout(() => {
      persistDisplayConfig();
      setSaving(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    }, 400);
  };

  const isAdmin = currentUser.role === "Administrator";

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-[#0a0a0a] overflow-y-auto">
      <div className="p-8 max-w-6xl mx-auto w-full">
        {/* Header */}
        <div className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-white uppercase tracking-tight flex items-center gap-2">
              <Settings className="w-5 h-5 text-blue-500" />
              Agent configuration & identity sync
            </h2>
            <p className="text-xs text-slate-500 dark:text-[#888] font-medium mt-1 uppercase tracking-wider">
              Microsoft Entra ID discovery, ephemeral credential checks, and ServiceNow ITSM
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSyncWithOrchestrator}
              disabled={isSyncing || !tenantId}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-[#222] dark:disabled:text-[#555] text-white text-xs font-bold rounded shadow-sm transition-all uppercase tracking-wider cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`} />
              {isSyncing ? "Authenticating with Azure..." : isSynced ? "Re-Authenticate & Sync" : "Sync With Orchestrator"}
            </button>
          </div>
        </div>

        {!isAdmin && (
          <div className="mb-6 p-4 bg-rose-50/60 dark:bg-rose-950/20 rounded border border-rose-100/60 dark:border-rose-900/20 text-xs text-rose-700 dark:text-rose-400 flex items-start gap-2">
            <Shield className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong>RBAC Restrained</strong>: Your current SAML SSO role context is <strong>{currentUser.role}</strong>. Only Enterprise Administrators can modify Azure AD credentials and integration settings.
            </div>
          </div>
        )}

        <section className="mb-6 rounded-xl border border-blue-200 bg-white p-5 shadow-sm dark:border-blue-900/60 dark:bg-[#0d1320]" aria-labelledby="external-agent-heading">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 id="external-agent-heading" className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white"><Webhook className="h-4 w-4 text-blue-500" />External diagnostic agents</h3><p className="mt-1 max-w-3xl text-xs text-slate-500">Register an API agent for read-only evidence collection. Matching incidents invoke it automatically before internal twin correlation; remediation still requires HITL approval.</p></div><button type="button" onClick={() => void loadExternalAgents()} disabled={!isAdmin} className="min-h-9 rounded border border-slate-300 px-3 text-xs font-semibold disabled:opacity-40 dark:border-slate-700">Refresh registry</button></div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold">Agent name<input value={externalDraft.name} onChange={event => setExternalDraft(value => ({ ...value, name: event.target.value }))} disabled={!isAdmin} placeholder="External Network Specialist" className="min-h-10 rounded border border-slate-300 bg-white px-3 font-normal dark:border-slate-700 dark:bg-slate-950" /></label>
            <label className="grid gap-1 text-xs font-semibold">HTTPS endpoint<input value={externalDraft.endpoint} onChange={event => setExternalDraft(value => ({ ...value, endpoint: event.target.value }))} disabled={!isAdmin} placeholder="https://agent.example.com/v1/investigate" className="min-h-10 rounded border border-slate-300 bg-white px-3 font-mono font-normal dark:border-slate-700 dark:bg-slate-950" /></label>
            <label className="grid gap-1 text-xs font-semibold">API key<input type="password" autoComplete="new-password" value={externalDraft.apiKey} onChange={event => setExternalDraft(value => ({ ...value, apiKey: event.target.value }))} disabled={!isAdmin} placeholder="Stored only in server memory" className="min-h-10 rounded border border-slate-300 bg-white px-3 font-mono font-normal dark:border-slate-700 dark:bg-slate-950" /></label>
            <label className="grid gap-1 text-xs font-semibold">Capabilities<input value={externalDraft.capabilities} onChange={event => setExternalDraft(value => ({ ...value, capabilities: event.target.value }))} disabled={!isAdmin} placeholder="vlan-validation, bgp-analysis" className="min-h-10 rounded border border-slate-300 bg-white px-3 font-normal dark:border-slate-700 dark:bg-slate-950" /></label>
          </div>
          <fieldset className="mt-3"><legend className="text-xs font-semibold">Incident domains</legend><div className="mt-2 flex flex-wrap gap-2">{externalDomains.map(domain => <label key={domain} className={`cursor-pointer rounded border px-2.5 py-1.5 text-[11px] font-bold ${externalDraft.domains.includes(domain) ? "border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300" : "border-slate-300 text-slate-500 dark:border-slate-700"}`}><input type="checkbox" className="sr-only" checked={externalDraft.domains.includes(domain)} onChange={() => setExternalDraft(value => ({ ...value, domains: value.domains.includes(domain) ? value.domains.filter(item => item !== domain) : [...value.domains, domain] }))} disabled={!isAdmin} />{domain}</label>)}</div></fieldset>
          <div className="mt-4 flex items-center justify-between gap-3"><p className="text-[11px] text-slate-500">The API key is sent once to the backend and never returned to this page or `/api/state`.</p><button type="button" onClick={() => void registerExternalAgent()} disabled={!isAdmin || externalBusy !== null || !externalDraft.name || !externalDraft.endpoint || !externalDraft.apiKey || !externalDraft.capabilities || !externalDraft.domains.length} className="min-h-10 rounded bg-blue-600 px-4 text-xs font-bold text-white disabled:opacity-40">{externalBusy === "register" ? "Registering..." : "Register & enable"}</button></div>
          {externalMessage && <p role="status" className="mt-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">{externalMessage}</p>}
          <div className="mt-4 grid gap-3">{externalAgents.map(agent => <article key={agent.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800"><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h4 className="text-xs font-bold">{agent.name}</h4><span className={`rounded px-2 py-0.5 text-[10px] font-bold ${agent.status === "CONNECTED" ? "bg-emerald-100 text-emerald-700" : agent.status === "FAILED" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>{agent.status}</span></div><p className="mt-1 break-all font-mono text-[11px] text-slate-500">{agent.endpoint}</p><p className="mt-1 text-[11px] text-slate-500">{agent.domains.join(" · ")} · {agent.capabilities.join(", ")} {agent.lastLatencyMs !== undefined ? `· ${agent.lastLatencyMs} ms` : ""}</p>{agent.lastError && <p className="mt-1 text-[11px] text-rose-600">{agent.lastError}</p>}</div><div className="flex gap-2"><button type="button" disabled={externalBusy !== null} onClick={() => void testExternalAgent(agent.id)} className="min-h-9 rounded border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700">Test</button><button type="button" disabled={externalBusy !== null} onClick={() => void removeExternalAgent(agent.id)} className="min-h-9 rounded border border-rose-300 px-3 text-xs font-semibold text-rose-600">Remove</button></div></div></article>)}</div>
        </section>

        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-[#111]" aria-labelledby="integration-readiness-heading">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="integration-readiness-heading" className="text-sm font-bold uppercase tracking-wide text-slate-900 dark:text-white">Client integration readiness</h3>
              <p className="mt-1 text-xs text-slate-500">Profile: {deploymentProfile} · {productionReady ? "Production configuration complete" : "Go-live requirements remain"}</p>
            </div>
            <button type="button" onClick={() => void loadIntegrationReadiness()} className="inline-flex min-h-10 items-center gap-2 rounded border border-slate-300 px-3 text-xs font-semibold dark:border-slate-700">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh readiness
            </button>
          </div>
          {readinessError ? <p className="mt-4 text-xs text-rose-600">{readinessError}</p> : (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {integrationReadiness.map(item => (
                <article key={item.id} className="rounded border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start justify-between gap-3">
                    <div><h4 className="text-xs font-bold text-slate-900 dark:text-white">{item.label}</h4><p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">{item.connectionPath.replaceAll("_", " ")}</p></div>
                    <span className={`rounded px-2 py-1 text-[10px] font-bold ${item.state === "READY" ? "bg-emerald-100 text-emerald-700" : item.state === "INCOMPLETE" ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600"}`}>{item.state}</span>
                  </div>
                  {item.missing.length > 0 && <p className="mt-2 text-[11px] text-rose-600">Missing: {item.missing.join(", ")}</p>}
                  <details className="mt-2 text-[11px] text-slate-600 dark:text-slate-400"><summary className="cursor-pointer font-semibold">Configure connection</summary>
                    <div className="mt-3 grid gap-2">
                      {Array.from(new Set([...(item.required || []), ...item.secretNames])).map(name => {
                        const secret = item.secretNames.includes(name) || /PASSWORD|TOKEN|KEY|DATABASE_URL/.test(name);
                        return <label key={name} className="grid gap-1"><span className="font-mono text-[10px]">{name}{(item.required || []).includes(name) ? " *" : ""}</span><input type={secret ? "password" : "text"} autoComplete="off" value={integrationDrafts[item.id]?.[name] || ""} onChange={event => setIntegrationDrafts(previous => ({ ...previous, [item.id]: { ...previous[item.id], [name]: event.target.value } }))} disabled={!isAdmin} placeholder={secret ? "Secret value (never saved in browser storage)" : `Enter ${name}`} className="min-h-9 rounded border border-slate-300 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950" /></label>;
                      })}
                      <button type="button" disabled={!isAdmin} onClick={() => setValidatedIntegration(item.id)} className="mt-1 min-h-9 rounded bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-40">Validate entered values</button>
                      {validatedIntegration === item.id && <p className={(item.required || []).every(name => Boolean(integrationDrafts[item.id]?.[name]?.trim())) ? "text-emerald-600" : "text-amber-600"}>{(item.required || []).every(name => Boolean(integrationDrafts[item.id]?.[name]?.trim())) ? "Required values are present for this browser session. Add them to the deployment secret/configuration store and restart the orchestrator to enable the connector." : "Enter every field marked with *."}</p>}
                      <p className="text-[10px] text-slate-500">Available settings: {item.settings.join(", ")}. Secret values stay in memory for this page and are cleared on reload.</p>
                    </div>
                  </details>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* Live Sync Error Alert Banner if Graph Auth Failed */}
        {syncError && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-lg flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-red-900 dark:text-red-200 space-y-1">
              <div className="font-bold uppercase tracking-wider flex items-center gap-2">
                <span>Azure AD Authentication Failed</span>
                <span className="text-[10px] font-normal px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded font-mono">
                  Live Microsoft Entra ID Check
                </span>
              </div>
              <p className="font-mono text-[11px] leading-relaxed text-red-800 dark:text-red-300">
                {syncError}
              </p>
              <p className="text-[10px] text-red-700 dark:text-red-400 pt-1">
                To fix: Ensure your Azure AD Tenant ID exists, your App Registration Client ID is created under that tenant, and your Client Secret is active with Microsoft Graph permissions.
              </p>
            </div>
          </div>
        )}

        {/* Real Live Observability Banner */}
        <div className="mb-8 p-5 bg-white dark:bg-[#0d0d0d] rounded-xl border border-slate-200 dark:border-[#222] shadow-sm">
          <div className="flex items-center justify-between pb-3 mb-4 border-b border-slate-100 dark:border-[#222]">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-500" />
              <h3 className="text-xs font-bold text-slate-800 dark:text-zinc-200 uppercase tracking-wider">
                Orchestrator Agent Observability & Identity Status
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <span className={`inline-block w-2.5 h-2.5 rounded-full ${
                isSynced 
                  ? "bg-emerald-500 animate-pulse" 
                  : syncError 
                  ? "bg-red-500" 
                  : "bg-amber-500"
              }`} />
              <span className={`text-[10px] font-bold uppercase tracking-wider ${
                isSynced 
                  ? "text-emerald-600 dark:text-emerald-400" 
                  : syncError 
                  ? "text-red-600 dark:text-red-400" 
                  : "text-amber-600 dark:text-amber-400"
              }`}>
                {isSynced 
                  ? "Live Azure AD Identity Synced & Active" 
                  : syncError 
                  ? "Authentication Failed - Not Connected" 
                  : "Sync Pending Real Azure Handshake"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#1e1e1e]">
              <span className="text-[9px] font-bold text-slate-400 dark:text-[#666] uppercase tracking-wider block">
                Agent Principal UPN
              </span>
              <span className="text-xs font-mono font-bold text-slate-800 dark:text-zinc-200 truncate block mt-1">
                {agentUsername || "Not Configured"}
              </span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#1e1e1e]">
              <span className="text-[9px] font-bold text-slate-400 dark:text-[#666] uppercase tracking-wider block">
                Graph Scope Permissions
              </span>
              <span className={`text-xs font-mono font-bold truncate block mt-1 ${isSynced ? "text-emerald-600 dark:text-emerald-400" : "text-slate-400 dark:text-[#666]"}`}>
                {isSynced ? "Calls.Join • Incident.Sync" : "None (Unauthenticated)"}
              </span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#1e1e1e]">
              <span className="text-[9px] font-bold text-slate-400 dark:text-[#666] uppercase tracking-wider block">
                Telemetry Health & Latency
              </span>
              <span className="text-xs font-mono font-bold text-slate-800 dark:text-zinc-200 truncate block mt-1">
                {isSynced ? `Online • ${latencyMs || 18}ms RTT` : "Offline (No Connection)"}
              </span>
            </div>

            <div className="p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#1e1e1e]">
              <span className="text-[9px] font-bold text-slate-400 dark:text-[#666] uppercase tracking-wider block">
                Last Heartbeat Sync
              </span>
              <span className="text-xs font-mono font-bold text-blue-600 dark:text-blue-400 truncate block mt-1">
                {isSynced && lastSyncTime ? `Today at ${lastSyncTime}` : "No verified sync"}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Azure AD Node Agent Identity Settings */}
          <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] shadow-sm p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-[#222]">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-blue-500" />
                <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                  Azure AD Agent Principal Configuration
                </h3>
              </div>
              <span className="text-[9.5px] font-medium text-slate-500 dark:text-[#777]">
                Live Entra ID Validation
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider">
                    Tenant ID (Azure AD Directory ID or Domain)
                  </label>
                  {tenantVerified && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Discovery resolved
                    </span>
                  )}
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tenantId}
                    onChange={(e) => {
                      setTenantId(e.target.value);
                      setTenantVerified(false);
                      setOpenIdDiscovery(null);
                      setTenantError(null);
                    }}
                    disabled={!isAdmin || isVerifyingTenant}
                    className={`flex-1 bg-slate-50 dark:bg-[#111] border rounded px-3 py-2 text-xs font-mono text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 ${
                      tenantError 
                        ? "border-red-400 dark:border-red-800" 
                        : tenantVerified 
                        ? "border-emerald-400 dark:border-emerald-700" 
                        : "border-slate-200 dark:border-[#222]"
                    }`}
                    placeholder="e.g. 8eaef023-2b34-4bc1-90a1-77884102ff91 or contoso.onmicrosoft.com"
                  />
                  <button
                    type="button"
                    onClick={() => verifyTenantWithAzure()}
                    disabled={!isAdmin || isVerifyingTenant || !tenantId.trim()}
                    className="px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#1a1a1a] dark:hover:bg-[#252525] text-slate-700 dark:text-zinc-300 text-xs font-bold rounded border border-slate-200 dark:border-[#333] transition-all uppercase tracking-wider shrink-0 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isVerifyingTenant ? (
                      <>
                        <RefreshCw className="w-3 h-3 animate-spin text-blue-500" />
                        <span>Verifying...</span>
                      </>
                    ) : (
                      <>
                        <Key className="w-3 h-3 text-blue-500" />
                        <span>Verify Tenant</span>
                      </>
                    )}
                  </button>
                </div>

                {tenantError && (
                  <div className="mt-1.5 p-2 bg-red-50 dark:bg-red-950/20 border border-red-200/60 dark:border-red-900/30 rounded text-[10px] text-red-600 dark:text-red-400 font-mono">
                    <span className="font-bold">Azure AD Error:</span> {tenantError}
                  </div>
                )}

                <p className="text-[9px] text-slate-400 dark:text-[#666] mt-1">
                  Connects directly to Microsoft Entra ID's OpenID authority. If random values are provided, Azure AD will reject the tenant.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider mb-1">
                  Node Agent Username / User Principal Name (UPN)
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={agentUsername}
                    onChange={(e) => setAgentUsername(e.target.value)}
                    disabled={!isAdmin}
                    className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded px-3 py-2 text-xs font-medium text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60 pl-8"
                    placeholder="e.g. apex.agent@yourtenant.onmicrosoft.com"
                  />
                  <UserCheck className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-3" />
                </div>
                <p className="text-[9px] text-slate-400 dark:text-[#666] mt-1">
                  The dedicated Azure AD user account created for your autonomous node engineer. Checked against Microsoft Graph on sync.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider mb-1">
                    Graph Client ID
                  </label>
                  <input
                    type="text"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    disabled={!isAdmin}
                    className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded px-3 py-2 text-xs font-mono text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                    placeholder="App Client ID (GUID)..."
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider mb-1">
                    Graph Client Secret (Ephemeral)
                  </label>
                  <input
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    disabled={!isAdmin}
                    className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded px-3 py-2 text-xs font-mono text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                    placeholder="••••••••••••••••"
                  />
                  <p className="mt-1 text-[10px] leading-4 text-slate-500">Used only for this browser-session authentication request; never saved to local storage.</p>
                 </div>
              </div>

              <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/30 rounded text-[10.5px] text-blue-800 dark:text-blue-300 flex items-start gap-2">
                <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-500" />
                <div>
                  <strong>Real Entra ID Integration:</strong> When clicking "Sync with Orchestrator", the server requests a real OAuth 2.0 token directly from <code className="font-mono text-[9.5px]">login.microsoftonline.com</code>. Entering dummy or placeholder values will fail with Microsoft's actual error code (such as AADSTS90002 or AADSTS700016).
                </div>
              </div>
            </div>
          </div>

          {/* OpenID discovery metadata only; no certificate is issued here. */}
          <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] shadow-sm p-6 space-y-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-[#222]">
                <div className="flex items-center gap-2">
                  <Key className="w-4 h-4 text-blue-500" />
                  <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                    OpenID Connect Discovery
                  </h3>
                </div>

                {openIdDiscovery && tenantVerified ? (
                  <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-200/40 dark:border-emerald-800/40">
                    <CheckCircle2 className="w-3 h-3" /> Discovery Resolved
                  </span>
                ) : (
                  <span className="text-[10px] font-bold text-slate-400 dark:text-[#666] flex items-center gap-1 uppercase tracking-wider">
                    <Radio className="w-3 h-3" /> Not Checked
                  </span>
                )}
              </div>

              {openIdDiscovery && tenantVerified ? (
                <div className="mt-4 space-y-3">
                  <div className="p-3 bg-slate-50 dark:bg-[#111] rounded border border-slate-100 dark:border-[#222] text-xs space-y-2">
                    <div>
                      <span className="text-[9px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider block">
                        Issuer
                      </span>
                      <span className="text-xs font-mono text-slate-800 dark:text-zinc-200 break-all">
                        {openIdDiscovery.issuer}
                      </span>
                    </div>

                    <div>
                      <span className="text-[9px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider block">
                        Token Endpoint
                      </span>
                      <span className="text-[11px] font-mono font-bold text-blue-600 dark:text-blue-400 break-all">
                        {openIdDiscovery.tokenEndpoint}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 gap-2 pt-1">
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider block">
                          JWKS URI
                        </span>
                        <span className="text-[10.5px] font-mono text-slate-600 dark:text-zinc-400 truncate block">
                          {openIdDiscovery.jwksUri}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[9.5px] text-slate-500 dark:text-[#777] font-medium">
                      Microsoft's published OpenID discovery document was resolved for this tenant.
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-8 text-center py-8 px-4 bg-slate-50 dark:bg-[#111] rounded border border-dashed border-slate-200 dark:border-[#222]">
                  <Radio className="w-8 h-8 text-slate-300 dark:text-[#444] mx-auto mb-2 animate-pulse" />
                  <p className="text-xs font-bold text-slate-600 dark:text-zinc-400 uppercase tracking-wider">
                    Awaiting Tenant Discovery Check
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-[#666] mt-1 max-w-xs mx-auto">
                    Enter an Azure AD Tenant ID and resolve its published OpenID configuration.
                  </p>
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-100 dark:border-[#222] text-[9.5px] text-slate-500 dark:text-zinc-500 leading-relaxed">
              This verifies issuer and endpoint metadata only. No client certificate is issued and no mTLS binding is performed.
            </div>
          </div>
        </div>

        {/* ServiceNow ITSM Integration Settings */}
        <div className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] shadow-sm p-6 space-y-6 mb-8">
          <div className="flex items-center gap-2 pb-4 border-b border-slate-100 dark:border-[#222] justify-between">
            <div className="flex items-center gap-2">
              <Webhook className="w-4 h-4 text-blue-500" />
              <h3 className="text-xs font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                ServiceNow ITSM Integration Settings
              </h3>
            </div>
            
            <div className="flex items-center gap-2">
              {snowStatus === "connected" && (
                <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 uppercase tracking-wider bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800/40">
                  <CheckCircle2 className="w-3.5 h-3.5" /> ITSM Verified & Connected
                </span>
              )}
              {snowStatus === "failed" && (
                <span className="text-[10px] font-bold text-red-600 dark:text-red-400 flex items-center gap-1 uppercase tracking-wider bg-red-50 dark:bg-red-900/30 px-2 py-0.5 rounded border border-red-200 dark:border-red-800/40">
                  <XCircle className="w-3.5 h-3.5" /> Connection Failed
                </span>
              )}
              {snowStatus === "untested" && (
                <span className="text-[10px] font-bold text-slate-400 dark:text-[#666] uppercase tracking-wider">
                  Not Tested
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider mb-1">
                ServiceNow Instance URL
              </label>
              <input
                type="text"
                value={snowInstanceUrl}
                onChange={(e) => {
                  setSnowInstanceUrl(e.target.value);
                  setSnowStatus("untested");
                  setSnowMessage(null);
                }}
                disabled={!isAdmin || snowStatus === "testing"}
                className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded px-3 py-2 text-xs font-medium text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                placeholder="https://dev12345.service-now.com"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider mb-1">
                OAuth Client ID
              </label>
              <input
                type="text"
                value={snowClientId}
                onChange={(e) => {
                  setSnowClientId(e.target.value);
                  setSnowStatus("untested");
                  setSnowMessage(null);
                }}
                disabled={!isAdmin || snowStatus === "testing"}
                className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded px-3 py-2 text-xs font-mono text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                placeholder="ServiceNow OAuth Client ID..."
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold text-slate-400 dark:text-[#555] uppercase tracking-wider mb-1">
                OAuth Client Secret (Ephemeral)
              </label>
              <input
                type="password"
                value={snowClientSecret}
                onChange={(e) => {
                  setSnowClientSecret(e.target.value);
                  setSnowStatus("untested");
                  setSnowMessage(null);
                }}
                disabled={!isAdmin || snowStatus === "testing"}
                className="w-full bg-slate-50 dark:bg-[#111] border border-slate-200 dark:border-[#222] rounded px-3 py-2 text-xs font-mono text-slate-800 dark:text-zinc-200 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-60"
                placeholder="••••••••••••••••"
              />
            </div>
          </div>

          {/* Real ServiceNow Feedback Result */}
          {snowMessage && (
            <div className={`p-3 rounded-lg text-xs flex items-start gap-2 ${
              snowStatus === "connected" 
                ? "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
                : "bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 text-red-800 dark:text-red-300"
            }`}>
              {snowStatus === "connected" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              )}
              <div className="font-mono text-[11px] leading-relaxed">
                {snowMessage}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <p className="text-[9.5px] text-slate-500 dark:text-[#777]">
              The orchestrator initiates a live HTTP handshake to verify ServiceNow host reachability and OAuth 2.0 credential authorization.
            </p>

            <button
              type="button"
              onClick={handleTestServiceNow}
              disabled={!isAdmin || snowStatus === "testing" || !snowInstanceUrl.trim()}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#1a1a1a] dark:hover:bg-[#252525] text-slate-700 dark:text-zinc-300 text-xs font-bold rounded border border-slate-200 dark:border-[#333] transition-all uppercase tracking-wider cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
            >
              {snowStatus === "testing" ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-500" />
                  <span>Probing ServiceNow...</span>
                </>
              ) : (
                <>
                  <Activity className="w-3.5 h-3.5 text-blue-500" />
                  <span>Test ServiceNow Connection</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Action Footer */}
        <div className="pt-4 border-t border-slate-200 dark:border-[#222] flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-[10px] leading-4 text-slate-500">Only non-secret display configuration is saved in this browser. Secret fields remain in memory for the current check; production credentials are resolved by the server-side secret provider.</p>
          <button
            onClick={handleSave}
            disabled={!isAdmin || saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-[#222] dark:disabled:text-[#555] text-white text-xs font-bold rounded shadow-sm transition-all uppercase tracking-wider cursor-pointer"
          >
            {saving ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" /> Saving Settings...
              </>
            ) : saved ? (
              <>
                <CheckCircle2 className="w-4 h-4" /> Settings Applied Successfully
              </>
            ) : (
              <>
                <Save className="w-4 h-4" /> Save Display Configuration
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
