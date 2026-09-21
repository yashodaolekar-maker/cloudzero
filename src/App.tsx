import React, { useState, useEffect, useRef } from "react";
import Sidebar from "./components/Sidebar";
import DashboardView from "./components/DashboardView";
import ApprovalsView from "./components/ApprovalsView";
import AgentsView from "./components/AgentsView";
import AuditLogView from "./components/AuditLogView";
import ApiPlaygroundView from "./components/ApiPlaygroundView";
import SettingsView from "./components/SettingsView";
import ServiceNowView from "./components/ServiceNowView";
import AgentConfigView from "./components/AgentConfigView";
import CrossSiloWorkflowView from "./components/CrossSiloWorkflowView";
import TeamEnablementView from "./components/TeamEnablementView";
import ActivityView from "./components/ActivityView";
import SettingsHubView from "./components/SettingsHubView";
import CyberFusionView from "./components/CyberFusionView";
import TwinWorkspaceView from "./components/TwinWorkspaceView";
import InvestigationView from "./components/InvestigationView";
import { 
  SSOUser, 
  DigitalTwinAgent, 
  HITLApproval, 
  SystemLog, 
  BackupItem, 
  WorkflowInstance, 
  PerformanceMetrics,
  ChangeRecord,
  ServiceNowIncident,
  CrossSiloWorkflow,
  TeamEnablementMetric,
  OperatingMode,
  TelemetrySnapshot
} from "./types";
import type { IncidentAggregate } from './types';
import { useDashboardEvents } from './hooks/useDashboardEvents';
import { RefreshCw, ShieldAlert } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { displaySafeData } from "./utils/displaySafe";

export default function App() {
  const reduceMotion = useReducedMotion();
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("cz_dark_mode");
    return saved ? saved === "true" : false; // Default to elegant Light Mode
  });

  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("a2aDemo") === "1" ? "cross-silo" : params.get("twinActivity") === "1" ? "agents" : "dashboard";
  });
  const [selectedTwinId, setSelectedTwinId] = useState(() => new URLSearchParams(window.location.search).get("twin") || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Synchronized state
  const [users, setUsers] = useState<SSOUser[]>([]);
  const [currentUser, setCurrentUser] = useState<SSOUser | null>(null);
  const [agents, setAgents] = useState<DigitalTwinAgent[]>([]);
  const [approvals, setApprovals] = useState<HITLApproval[]>([]);
  const [workflows, setWorkflows] = useState<WorkflowInstance[]>([]);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([]);
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [changeRecords, setChangeRecords] = useState<ChangeRecord[]>([]);
  const [incidents, setIncidents] = useState<ServiceNowIncident[]>([]);
  const [crossSiloWorkflows, setCrossSiloWorkflows] = useState<CrossSiloWorkflow[]>([]);
  const [enablementMetrics, setEnablementMetrics] = useState<TeamEnablementMetric[]>([]);
  const [operatingMode, setOperatingMode] = useState<OperatingMode>("SIMULATION");
  const [telemetrySnapshot, setTelemetrySnapshot] = useState<TelemetrySnapshot | null>(null);
  const [telemetryLoading, setTelemetryLoading] = useState(true);
  const [telemetryRefreshing, setTelemetryRefreshing] = useState(false);
  const [telemetryError, setTelemetryError] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("incident"));
  const [incidentEvents, setIncidentEvents] = useState<Array<Record<string, unknown>>>([]);
  const stateRequestSequence = useRef(0);
  const incidentRequestSequence = useRef(0);
  const [dashboardAggregates, setDashboardAggregates] = useState<IncidentAggregate[] | undefined>();
  const [dashboardInspectedId, setDashboardInspectedId] = useState<string | undefined>();
  const dashboardEvents = useDashboardEvents(incidents, workflows, dashboardInspectedId, activeTab === 'dashboard' && Boolean(currentUser), `${currentUser?.id || ''}:${currentUser?.role || ''}`);
  const [loginUsername, setLoginUsername] = useState("admin");
  const [loginPassword, setLoginPassword] = useState("admin");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // In-flight loading flags
  const [workflowTriggering, setWorkflowTriggering] = useState(false);
  const [approving, setApproving] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);

  // Sync Dark Mode state to DOM
  useEffect(() => {
    const root = window.document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("cz_dark_mode", String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    const syncLocation = () => {
      const params = new URLSearchParams(window.location.search);
      const twin = params.get("twin") || "";
      const incident = params.get("incident");
      setSelectedTwinId(twin);
      if (twin) setActiveTab("agents");
      setSelectedIncidentId(incident);
      if (incident) setActiveTab("servicenow");
    };
    window.addEventListener("popstate", syncLocation);
    return () => window.removeEventListener("popstate", syncLocation);
  }, []);

  const openTwinWorkspace = (twinId: string) => {
    const aliases: Record<string, string> = { network: "networking", database: "dba" };
    const id = aliases[twinId.toLowerCase()] || twinId.toLowerCase().replace(/\s+/g, "-");
    const params = new URLSearchParams(window.location.search);
    params.set("twin", id);
    window.history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
    setSelectedTwinId(id);
    setActiveTab("agents");
  };

  const closeTwinWorkspace = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("twin");
    const query = params.toString();
    window.history.pushState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    setSelectedTwinId("");
    setActiveTab("agents");
  };

  const navigateFromSidebar = (tab: string) => {
    if (selectedTwinId) {
      const params = new URLSearchParams(window.location.search);
      params.delete("twin");
      const query = params.toString();
      window.history.pushState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      setSelectedTwinId("");
    }
    setActiveTab(tab);
  };

  const openInvestigation = (incidentId: string) => {
    const params = new URLSearchParams(window.location.search);
    params.set("incident", incidentId);
    window.history.pushState({}, "", `${window.location.pathname}?${params.toString()}`);
    setSelectedIncidentId(incidentId);
    setActiveTab("servicenow");
  };

  const closeInvestigation = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("incident");
    const query = params.toString();
    window.history.pushState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    setSelectedIncidentId(null);
  };

  // Fetch initial state and start real-time polling
  const fetchState = async (showLoadingSpinner = false) => {
    const requestId = ++stateRequestSequence.current;
    if (showLoadingSpinner) setLoading(true);
    try {
      const response = await fetch("/api/state");
      if (!response.ok) {
        if (response.status === 401) { setCurrentUser(null); setError("AUTH_REQUIRED"); return; }
        throw new Error(`HTTP Error: ${response.status}`);
      }
      const data = displaySafeData(await response.json());
      if (requestId !== stateRequestSequence.current) return;
      setUsers(data.users);
      setCurrentUser(data.currentUser);
      setAgents(data.agents);
      setApprovals(data.approvals);
      setWorkflows(data.workflows);
      setBackups(data.backups);
      setSystemLogs(data.systemLogs);
      setMetrics(data.metrics);
      setChangeRecords(data.changeRecords || []);
      setIncidents(data.serviceNowIncidents || []);
      setDashboardAggregates(Array.isArray(data.incidentAggregates) ? data.incidentAggregates : undefined);
      setCrossSiloWorkflows(data.crossSiloWorkflows || []);
      setEnablementMetrics(data.teamEnablementMetrics || []);
      setOperatingMode(data.operatingMode || "SIMULATION");
      setError(null);
    } catch (e: any) {
      console.warn("Failed to fetch orchestrator state:", e);
      // Only trigger full-screen block error if we have no existing cached metrics
      if (showLoadingSpinner) {
        setError("Failed to establish secure handshake with Cloud Zero server kernel.");
      }
    } finally {
      if (showLoadingSpinner && requestId === stateRequestSequence.current) setLoading(false);
    }
  };

  // Telemetry is deliberately fetched independently from orchestrator state.
  // A connector failure must not hide the rest of the incident command center,
  // and the last successful snapshot remains visible while it visibly ages.
  const fetchTelemetry = async (initialLoad = false, forceRefresh = false) => {
    if (initialLoad) setTelemetryLoading(true);
    else setTelemetryRefreshing(true);
    try {
      const response = await fetch(forceRefresh ? "/api/telemetry/snapshot?refresh=true" : "/api/telemetry/snapshot", {
        headers: { Accept: "application/json" },
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error(`Telemetry endpoint returned HTTP ${response.status}.`);
      }
      const snapshot: TelemetrySnapshot = await response.json();
      if (!snapshot || !Array.isArray(snapshot.connectors) || !Array.isArray(snapshot.metrics) || !Array.isArray(snapshot.anomalies)) {
        throw new Error("Telemetry endpoint returned an invalid snapshot.");
      }
      setTelemetrySnapshot(snapshot);
      setTelemetryError(null);
    } catch (telemetryFailure) {
      console.warn("Failed to refresh connector telemetry:", telemetryFailure);
      setTelemetryError(telemetryFailure instanceof Error ? telemetryFailure.message : "Connector telemetry refresh failed.");
    } finally {
      if (initialLoad) setTelemetryLoading(false);
      else setTelemetryRefreshing(false);
    }
  };

  useEffect(() => {
    fetchState(true);

    // Stream domain events for low-latency updates. A slower reconciliation poll
    // protects against proxy disconnects or missed events.
    const stream = new EventSource("/api/stream");
    stream.addEventListener("incident-event", () => fetchState(false));
    stream.onerror = () => console.warn("Incident event stream disconnected; reconciliation polling remains active.");
    const interval = setInterval(() => {
      fetchState(false);
    }, 30000);

    return () => {
      stream.close();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const incidentId = selectedIncidentId;
    const requestId = ++incidentRequestSequence.current;
    if (!incidentId) { setIncidentEvents([]); return; }
    const controller = new AbortController();
    setIncidentEvents([]);
    fetch(`/api/incidents/${encodeURIComponent(incidentId)}/events`, { headers: { Accept: "application/json" }, cache: "no-store", signal: controller.signal })
      .then(response => response.ok ? response.json() : Promise.reject(new Error(`Incident events returned HTTP ${response.status}`)))
      .then(data => { if (requestId === incidentRequestSequence.current) setIncidentEvents(Array.isArray(data.events) ? data.events : []); })
      .catch(error => { if (error?.name !== "AbortError") console.warn("Incident event ledger unavailable:", error); });
    return () => controller.abort();
  }, [selectedIncidentId, incidents]);

  useEffect(() => {
    fetchTelemetry(true);
    const telemetryPoll = window.setInterval(() => {
      fetchTelemetry(false);
    }, 30000);

    return () => window.clearInterval(telemetryPoll);
  }, []);

  // SSO Session Change (RBAC enforcement)
  const handleUserChange = async (userId: string) => {
    try {
      const response = await fetch("/api/set-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (response.ok) {
        const data = await response.json();
        setCurrentUser(data.currentUser);
        fetchState(false);
      }
    } catch (e) {
      console.error("Failed to change user session:", e);
    }
  };

  // Trigger Digital Twin workflow
  const handleTriggerWorkflow = async (agentId: string, workflowName: string) => {
    setWorkflowTriggering(true);
    try {
      const response = await fetch("/api/trigger-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, workflowName }),
      });
      if (response.ok) {
        await fetchState(false);
        // Switch to approvals tab to immediately view the pending action
        setActiveTab("approvals");
      } else {
        const errData = await response.json();
        alert(errData.error || "Failed to trigger automated workflow.");
      }
    } catch (e) {
      console.error("Failed to trigger workflow:", e);
    } finally {
      setWorkflowTriggering(false);
    }
  };

  // Approve or Deny HITL Action
  const handleApproveAction = async (approvalId: string, status: "APPROVED" | "DENIED", comment: string) => {
    setApproving(true);
    try {
      const response = await fetch("/api/approve-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, status, comment }),
      });
      if (response.ok) {
        await fetchState(false);
      } else {
        const errData = await response.json();
        alert(errData.error || "Unauthorized: Check active SAML SSO credentials.");
      }
    } catch (e) {
      console.error("Failed to handle HITL approval:", e);
    } finally {
      setApproving(false);
    }
  };

  // Trigger Manual Encrypted Backup
  const handleCreateBackup = async () => {
    setBackupLoading(true);
    try {
      const response = await fetch("/api/create-backup", { method: "POST" });
      if (response.ok) {
        await fetchState(false);
      } else {
        const errData = await response.json();
        alert(errData.error || "Unauthorized.");
      }
    } catch (e) {
      console.error("Failed to trigger backup:", e);
    } finally {
      setBackupLoading(false);
    }
  };

  // Restore Database State from Backup
  const handleRestoreBackup = async (backupId: string) => {
    setRestoreLoading(true);
    try {
      const response = await fetch("/api/restore-backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ backupId }),
      });
      if (response.ok) {
        const data = await response.json();
        alert(data.message);
        await fetchState(false);
      } else {
        const errData = await response.json();
        alert(errData.error || "Unauthorized restoration attempt.");
      }
    } catch (e) {
      console.error("Failed to restore backup:", e);
    } finally {
      setRestoreLoading(false);
    }
  };

  // ServiceNow Incident Triggering
  const handleTriggerIncident = async (category: "Wireless" | "Switch" | "SDWAN") => {
    try {
      const response = await fetch("/api/servicenow/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Incident action failed (${response.status}).`);
      }
      await fetchState(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Incident action failed. Please retry.");
    }
  };

  // ServiceNow Add Work Note
  const handleAddWorkNote = async (incidentId: string, text: string, author: string) => {
    try {
      const response = await fetch("/api/servicenow/add-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId, text, author })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Incident action failed (${response.status}).`);
      }
      await fetchState(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Incident action failed. Please retry.");
      throw e;
    }
  };

  // ServiceNow Advance SLA clock
  const handleAdvanceTime = async (minutes: number, incidentId?: string) => {
    try {
      const response = await fetch("/api/servicenow/advance-time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes, incidentId })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Incident action failed (${response.status}).`);
      }
      await fetchState(false);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Incident action failed. Please retry.");
    }
  };

  const handleTakeoverIncident = async (incidentId: string) => {
    try {
      const response = await fetch(`/api/engineering/incidents/${encodeURIComponent(incidentId)}/takeover`, { method: "POST" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Investigation failed (${response.status}).`);
      }
      await fetchState(false);
    } catch (e) { alert(e instanceof Error ? e.message : "Unable to start the incident investigation."); throw e; }
  };

  // ServiceNow Resolve Incident
  const handleResolveIncident = async (incidentId: string) => {
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: "RESOLVED",
          reason: "Operator marked the incident resolved after reviewing the incident evidence and recovery state."
        })
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Incident action failed (${response.status}).`);
      }
      await fetchState(false);
    } catch (e) {
      throw new Error(e instanceof Error ? e.message : "Incident action failed. Please retry.");
    }
  };

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError(null);
    try {
      const response = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: loginUsername, password: loginPassword }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Login failed.");
      setCurrentUser(data.currentUser);
      setError(null);
      await fetchState(true);
      await fetchTelemetry(true);
    } catch (loginFailure: any) { setError("AUTH_REQUIRED"); setLoginError(loginFailure.message || "Login failed."); }
    finally { setLoginBusy(false); }
  };

  const handleResetSdwanDemoIncidents = async () => {
    const response = await fetch("/api/demo/sdwan-incidents/reset", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Unable to restore the SD-WAN demo incidents.");
    await fetchState(false);
  };

  if (loading) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-900 text-white font-sans">
        <RefreshCw className="w-8 h-8 text-indigo-500 animate-spin mb-3" />
        <h3 className="font-bold text-sm tracking-widest uppercase">Initializing Cloud Zero Orchestrator</h3>
        <p className="text-xs text-zinc-500 mt-1">Establishing SAML SSO session handshake & decrypting local states...</p>
      </div>
    );
  }

  if (error === "AUTH_REQUIRED") {
    return <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6"><form onSubmit={handleLogin} className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-7 shadow-2xl"><div className="mb-6"><p className="text-xs uppercase tracking-[0.25em] text-indigo-300">Cloud Zero</p><h1 className="mt-2 text-2xl font-bold">Secure sign in</h1><p className="mt-2 text-sm text-slate-400">Authenticate through the PostgreSQL-backed local identity service.</p></div><label className="block text-sm font-medium">Username<input value={loginUsername} onChange={event => setLoginUsername(event.target.value)} autoComplete="username" className="mt-2 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-white" /></label><label className="mt-4 block text-sm font-medium">Password<input type="password" value={loginPassword} onChange={event => setLoginPassword(event.target.value)} autoComplete="current-password" className="mt-2 w-full rounded border border-slate-600 bg-slate-950 px-3 py-2 text-white" /></label>{loginError && <p className="mt-3 text-sm text-rose-300">{loginError}</p>}<button disabled={loginBusy} className="mt-6 w-full rounded bg-indigo-600 px-4 py-2.5 font-semibold hover:bg-indigo-500 disabled:opacity-50">{loginBusy ? "Signing in…" : "Sign in"}</button><p className="mt-4 text-xs text-slate-500">Local credentials: admin / admin</p></form></main>;
  }
  if (error || !currentUser || !metrics) {
    return (
      <div className="w-screen h-screen flex flex-col items-center justify-center bg-slate-900 text-white font-sans p-6 text-center">
        <ShieldAlert className="w-12 h-12 text-rose-500 mb-4" />
        <h3 className="font-bold text-base tracking-wide uppercase">Core Handshake Timeout</h3>
        <p className="text-xs text-zinc-400 mt-2 max-w-md leading-relaxed">{error || "Failed to fetch orchestrator credentials."}</p>
        <button
          onClick={() => fetchState(true)}
          className="mt-6 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors"
        >
          Retry Connection Handshake
        </button>
      </div>
    );
  }

  return (
    <div className="cz-app-shell w-screen h-screen flex overflow-hidden text-slate-800 dark:text-slate-100 font-sans transition-colors duration-200">
      
      {/* Sidebar Layout */}
      <Sidebar
        currentUser={currentUser}
        users={users}
        onUserChange={handleUserChange}
        activeTab={activeTab}
        setActiveTab={navigateFromSidebar}
        darkMode={darkMode}
        setDarkMode={setDarkMode}
        approvals={approvals}
      />

      {/* Main Content Area */}
      <main className="cz-main flex-1 overflow-y-auto overflow-x-hidden relative pt-16 lg:pt-0">
        <AnimatePresence mode="wait" initial={false}>
        <motion.div key={selectedTwinId ? `twin-${selectedTwinId}` : activeTab} className="min-h-full" initial={{ opacity: 0, y: reduceMotion ? 0 : 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }} transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}>
        {selectedTwinId && (
          <TwinWorkspaceView twinId={selectedTwinId} agents={agents} onBack={closeTwinWorkspace} />
        )}
        {!selectedTwinId && <>
        {activeTab === "dashboard" && (
          <DashboardView
            currentUser={currentUser}
            agents={agents}
            workflows={workflows}
            approvals={approvals}
            systemLogs={systemLogs}
            onTriggerWorkflow={handleTriggerWorkflow}
            workflowTriggering={workflowTriggering}
            incidents={incidents}
            aggregates={dashboardAggregates}
            eventsByIncident={dashboardEvents}
            onInspectIncident={setDashboardInspectedId}
            onOpenIncident={openInvestigation}
            onOpenTwin={openTwinWorkspace}
            setActiveTab={setActiveTab}
            operatingMode={operatingMode}
            telemetrySnapshot={telemetrySnapshot}
            telemetryLoading={telemetryLoading}
            telemetryRefreshing={telemetryRefreshing}
            telemetryError={telemetryError}
            onRefreshTelemetry={() => fetchTelemetry(false, true)}
          />
        )}

        {activeTab === "cross-silo" && (
          <CrossSiloWorkflowView
            currentUser={currentUser}
            agents={agents}
            crossSiloWorkflows={crossSiloWorkflows}
            approvals={approvals}
            setActiveTab={setActiveTab}
            onRefreshState={() => fetchState(false)}
            operatingMode={operatingMode}
          />
        )}

        {activeTab === "cyber-fusion" && (
          <CyberFusionView setActiveTab={setActiveTab} />
        )}

        {activeTab === "enablement" && (
          <TeamEnablementView
            currentUser={currentUser}
            metrics={enablementMetrics}
            setActiveTab={setActiveTab}
          />
        )}

        {activeTab === "activity" && (
          <ActivityView
            currentUser={currentUser}
            approvals={approvals}
            systemLogs={systemLogs}
            changeRecords={changeRecords}
            onApproveAction={handleApproveAction}
            approving={approving}
            fetchState={() => fetchState(false)}
          />
        )}

        {activeTab === "approvals" && (
          <ApprovalsView
            currentUser={currentUser}
            approvals={approvals}
            onApproveAction={handleApproveAction}
            approving={approving}
            changeRecords={changeRecords}
            fetchState={() => fetchState(false)}
          />
        )}

        {activeTab === "agents" && (
          <AgentsView agents={agents} onOpenTwin={openTwinWorkspace} />
        )}

        {activeTab === "audit" && (
          <AuditLogView systemLogs={systemLogs} />
        )}

        {activeTab === "api-playground" && (
          <ApiPlaygroundView />
        )}

        {activeTab === "backups" && (
          <SettingsView
            currentUser={currentUser}
            backups={backups}
            onCreateBackup={handleCreateBackup}
            onRestoreBackup={handleRestoreBackup}
            backupLoading={backupLoading}
            restoreLoading={restoreLoading}
          />
        )}

        {activeTab === "settings" && (
          <SettingsHubView
            currentUser={currentUser}
            backups={backups}
            onCreateBackup={handleCreateBackup}
            onRestoreBackup={handleRestoreBackup}
            backupLoading={backupLoading}
            restoreLoading={restoreLoading}
          />
        )}

        {activeTab === "servicenow" && (
          selectedIncidentId ? <InvestigationView
            incident={incidents.find(item => item.id === selectedIncidentId)}
            incidents={incidents}
            agents={agents}
            workflows={workflows}
            approvals={approvals}
            systemLogs={systemLogs}
            crossSiloWorkflows={crossSiloWorkflows}
            evidence={dashboardAggregates?.find(item => item.incidentId === selectedIncidentId)?.evidence}
            rawEvents={incidentEvents}
            onSelectIncident={openInvestigation}
            onBack={closeInvestigation}
            onTakeover={handleTakeoverIncident}
          /> : <ServiceNowView
            currentUser={currentUser}
            incidents={incidents}
            agents={agents}
            approvals={approvals}
            onTriggerIncident={handleTriggerIncident}
            onAddWorkNote={handleAddWorkNote}
            onAdvanceTime={handleAdvanceTime}
            onTakeoverIncident={handleTakeoverIncident}
            onResolveIncident={handleResolveIncident}
            onResetSdwanDemoIncidents={handleResetSdwanDemoIncidents}
            onRefreshState={() => fetchState(false)}
            onOpenInvestigation={openInvestigation}
          />
        )}
        </>}
        </motion.div>
        </AnimatePresence>
      </main>

    </div>
  );
}
