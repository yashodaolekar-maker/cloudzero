import React, { useState, useEffect, useRef } from "react";
import { UserRole } from "../types";
import { 
  ServiceNowIncident, 
  SSOUser, 
  DigitalTwinAgent,
  HITLApproval
} from "../types";
import { 
  Activity, 
  ShieldAlert, 
  Server, 
  Wifi, 
  Layers, 
  AlertCircle, 
  Clock, 
  User, 
  UserCheck, 
  PlusCircle, 
  ArrowRight, 
  CornerDownRight, 
  Send, 
  RefreshCw,
  RotateCcw,
  Sliders, 
  Bot, 
  CheckCircle,
  HelpCircle,
  AlertTriangle,
  AlertOctagon,
  History,
  Languages,
  Volume2,
  Radio,
  Loader2,
  Headphones
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { IncidentSpeechPanel } from "./IncidentSpeechPanel";
import { AgentCollaborationPanel } from "./AgentCollaborationPanel";

interface IncidentVoiceUpdate {
  incidentId: string;
  region: string;
  languageCode: string;
  modelName: string;
  translatedSummary: string;
  audioUrl: string;
  generatedAt: string;
  bridgeStatus: string;
  auditStatus: string;
  message?: string;
}

type VoiceRequestKind = "preview" | "bridge";

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null
);

const isIncidentVoiceUpdate = (value: unknown): value is IncidentVoiceUpdate => {
  if (!isRecord(value)) return false;

  return [
    "incidentId",
    "region",
    "languageCode",
    "modelName",
    "translatedSummary",
    "audioUrl",
    "generatedAt",
    "bridgeStatus",
    "auditStatus"
  ].every((field) => typeof value[field] === "string")
    && (value.message === undefined || typeof value.message === "string");
};

const getSameOriginAudioUrl = (audioUrl: string) => {
  const resolvedAudioUrl = new URL(audioUrl, window.location.origin);
  if (resolvedAudioUrl.origin !== window.location.origin) {
    throw new Error("The voice service returned an unsafe audio location.");
  }

  return `${resolvedAudioUrl.pathname}${resolvedAudioUrl.search}${resolvedAudioUrl.hash}`;
};

const getApiErrorMessage = (payload: unknown, status: number) => {
  if (isRecord(payload)) {
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
    if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
    if (isRecord(payload.error) && typeof payload.error.message === "string" && payload.error.message.trim()) {
      return payload.error.message;
    }
  }

  return `Voice update request failed (${status}). Please retry.`;
};

const getBridgeStatusClass = (status: string) => {
  const normalized = status.toUpperCase();
  if (normalized.includes("PUBLISH") || normalized.includes("STREAM") || normalized.includes("SENT")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-400";
  }
  if (normalized.includes("FAIL") || normalized.includes("ERROR")) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-400";
  }
  return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-400";
};

const getAuditStatusClass = (status: string) => {
  const normalized = status.toUpperCase();
  if (normalized.includes("FAIL") || normalized.includes("ERROR")) {
    return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-400";
  }
  if (normalized.includes("LOG") || normalized.includes("WRITE") || normalized.includes("COMPLETE") || normalized.includes("SIMULAT")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-400";
  }
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400";
};

const isBridgeApprovalForIncident = (approval: HITLApproval, incidentId: string) => {
  const bridgeIntent = `${approval.system} ${approval.action} ${approval.description}`;
  return approval.status === "APPROVED"
    && approval.incidentId === incidentId
    && typeof approval.workflowId === "string"
    && approval.workflowId.trim().length > 0
    && /\b(teams|webex|bridge)\b/i.test(bridgeIntent);
};

interface ServiceNowViewProps {
  currentUser: SSOUser;
  incidents: ServiceNowIncident[];
  agents: DigitalTwinAgent[];
  approvals: HITLApproval[];
  onTriggerIncident: (category: "Wireless" | "Switch" | "SDWAN") => void;
  onAddWorkNote: (incidentId: string, text: string, author: string) => Promise<void>;
  onAdvanceTime: (minutes: number, incidentId?: string) => void;
  onTakeoverIncident: (incidentId: string) => Promise<void>;
  onResolveIncident: (incidentId: string) => Promise<void>;
  onResetSdwanDemoIncidents: () => Promise<void>;
  onRefreshState: () => void;
  onOpenInvestigation?: (incidentId: string) => void;
}

export default function ServiceNowView({
  currentUser,
  incidents,
  agents,
  approvals,
  onTriggerIncident,
  onAddWorkNote,
  onAdvanceTime,
  onTakeoverIncident,
  onResolveIncident,
  onResetSdwanDemoIncidents,
  onRefreshState,
  onOpenInvestigation
}: ServiceNowViewProps) {
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [newWorkNoteText, setNewWorkNoteText] = useState("");
  const [isLiveClockActive, setIsLiveClockActive] = useState(false);
  const [sidecarOpen, setSidecarOpen] = useState(false);
  const [takingOver, setTakingOver] = useState<string | null>(null);
  async function takeOver(incidentId: string) {
    if (takingOver) return;
    setTakingOver(incidentId);
    try { await onTakeoverIncident(incidentId); }
    finally { setTakingOver(null); }
  }
  async function resetSdwanDemoPack() {
    if (resettingDemoPack) return;
    setResettingDemoPack(true);
    setDemoResetMessage(null);
    try {
      await onResetSdwanDemoIncidents();
      setSelectedIncidentId("DEMO-SDWAN-ZIA-001");
      setDemoResetMessage("10 SD-WAN demo incidents restored to their original state.");
    } catch (error) {
      setDemoResetMessage(error instanceof Error ? error.message : "Unable to restore the demo incidents.");
    } finally {
      setResettingDemoPack(false);
    }
  }
  const [sidecarSlaMinutes, setSidecarSlaMinutes] = useState(30);
  const [sidecarNote, setSidecarNote] = useState("");
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);
  const [resettingDemoPack, setResettingDemoPack] = useState(false);
  const [demoResetMessage, setDemoResetMessage] = useState<string | null>(null);
  const [resolvingIncident, setResolvingIncident] = useState<string | null>(null);
  const [resolutionMessage, setResolutionMessage] = useState<{ incidentId: string; kind: "SUCCESS" | "ERROR"; text: string } | null>(null);
  const [voiceByIncident, setVoiceByIncident] = useState<Record<string, IncidentVoiceUpdate>>({});
  const [voiceErrorsByIncident, setVoiceErrorsByIncident] = useState<Record<string, string | undefined>>({});
  const [voiceRequestsByIncident, setVoiceRequestsByIncident] = useState<Record<string, VoiceRequestKind | undefined>>({});
  const [voiceHydrationByIncident, setVoiceHydrationByIncident] = useState<Record<string, boolean | undefined>>({});
  const [voiceHydrationErrorsByIncident, setVoiceHydrationErrorsByIncident] = useState<Record<string, string | undefined>>({});
  const voiceHydrationController = useRef<AbortController | null>(null);
  const incidentDetailsRef = useRef<HTMLDivElement | null>(null);

  const selectedIncident = incidents.find(i => i.id === selectedIncidentId) || incidents[0];

  function openIncidentDetails(incidentId: string) {
    setSelectedIncidentId(incidentId);
    window.requestAnimationFrame(() => {
      incidentDetailsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  // Sync selected ID when incidents load
  useEffect(() => {
    if (incidents.length === 0) {
      if (selectedIncidentId !== null) setSelectedIncidentId(null);
      return;
    }
    if (!selectedIncidentId || !incidents.some(incident => incident.id === selectedIncidentId)) {
      setSelectedIncidentId(incidents[0].id);
    }
  }, [incidents, selectedIncidentId]);

  // Hydrate any durable voice artifact for the selected incident. The controller
  // prevents a slower response from one ticket appearing under another ticket.
  useEffect(() => {
    const incidentId = selectedIncident?.id;
    if (!incidentId) return;

    voiceHydrationController.current?.abort();
    const controller = new AbortController();
    voiceHydrationController.current = controller;
    setVoiceHydrationByIncident((current) => ({ ...current, [incidentId]: true }));
    setVoiceHydrationErrorsByIncident((current) => ({ ...current, [incidentId]: undefined }));

    void (async () => {
      try {
        const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/voice-update`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal
        });

        let payload: unknown = null;
        try {
          payload = await response.json();
        } catch {
          // Response validation below supplies a concise error without leaking response text.
        }

        if (!response.ok) {
          throw new Error(getApiErrorMessage(payload, response.status));
        }
        if (!isRecord(payload) || payload.success !== true) {
          throw new Error("The voice service returned an incomplete cached-output response.");
        }
        const hydratedVoice = payload.voice;
        if (controller.signal.aborted || voiceHydrationController.current !== controller) return;

        if (hydratedVoice === null) {
          setVoiceByIncident((current) => {
            const next = { ...current };
            delete next[incidentId];
            return next;
          });
          return;
        }

        if (!isIncidentVoiceUpdate(hydratedVoice)) {
          throw new Error("The voice service returned an incomplete cached-output response.");
        }

        const voice = hydratedVoice;
        if (voice.incidentId !== incidentId) {
          throw new Error("The voice service returned cached audio for a different incident.");
        }

        setVoiceByIncident((current) => ({
          ...current,
          [incidentId]: {
            ...voice,
            audioUrl: getSameOriginAudioUrl(voice.audioUrl)
          }
        }));
      } catch (error) {
        if (controller.signal.aborted || voiceHydrationController.current !== controller) return;
        setVoiceHydrationErrorsByIncident((current) => ({
          ...current,
          [incidentId]: error instanceof Error ? error.message : "Cached voice output could not be loaded."
        }));
      } finally {
        if (voiceHydrationController.current === controller) {
          voiceHydrationController.current = null;
          setVoiceHydrationByIncident((current) => ({ ...current, [incidentId]: false }));
        }
      }
    })();

    return () => {
      controller.abort();
      if (voiceHydrationController.current === controller) {
        voiceHydrationController.current = null;
      }
    };
  }, [selectedIncident?.id]);

  // Live simulation tick (1 real second = 1 virtual minute)
  useEffect(() => {
    let interval: any = null;
    if (isLiveClockActive) {
      interval = setInterval(() => {
        onAdvanceTime(1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLiveClockActive, onAdvanceTime]);

  const handleAddNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWorkNoteText.trim() || !selectedIncident) return;
    
    setIsSubmittingNote(true);
    try {
      await onAddWorkNote(selectedIncident.id, newWorkNoteText, `${currentUser.name} (${currentUser.role})`);
      setNewWorkNoteText("");
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmittingNote(false);
    }
  };

  const handleVoiceUpdate = async (incidentId: string, publishToBridge: boolean) => {
    const bridgeApproval = publishToBridge
      ? approvals.find((approval) => isBridgeApprovalForIncident(approval, incidentId))
      : undefined;

    if (publishToBridge && (!bridgeApproval?.workflowId || bridgeApproval.incidentId !== incidentId)) {
      setVoiceErrorsByIncident((current) => ({
        ...current,
        [incidentId]: "Exact incident/workflow approval required before publishing audio to Teams or Webex."
      }));
      return;
    }

    voiceHydrationController.current?.abort();
    voiceHydrationController.current = null;
    setVoiceHydrationByIncident((current) => ({ ...current, [incidentId]: false }));
    setVoiceHydrationErrorsByIncident((current) => ({ ...current, [incidentId]: undefined }));

    const regenerate = Boolean(voiceByIncident[incidentId]);
    const requestKind: VoiceRequestKind = publishToBridge ? "bridge" : "preview";
    setVoiceRequestsByIncident((current) => ({ ...current, [incidentId]: requestKind }));
    setVoiceErrorsByIncident((current) => ({ ...current, [incidentId]: undefined }));

    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/voice-update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publishToBridge
          ? {
              publishToBridge: true,
              regenerate: true,
              approvalId: bridgeApproval!.id,
              workflowId: bridgeApproval!.workflowId
            }
          : { publishToBridge: false, regenerate })
      });

      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // A concise status-based error below is more useful than exposing malformed response text.
      }

      if (!response.ok) {
        throw new Error(getApiErrorMessage(payload, response.status));
      }

      if (!isRecord(payload) || payload.success !== true || !isIncidentVoiceUpdate(payload.voice)) {
        throw new Error("The voice service returned an incomplete response. Please retry.");
      }

      const voice = payload.voice;
      if (voice.incidentId !== incidentId) {
        throw new Error("The voice service returned audio for a different incident.");
      }
      setVoiceByIncident((current) => ({
        ...current,
        [incidentId]: {
          ...voice,
          audioUrl: getSameOriginAudioUrl(voice.audioUrl)
        }
      }));
      onRefreshState();
    } catch (error) {
      setVoiceErrorsByIncident((current) => ({
        ...current,
        [incidentId]: error instanceof Error ? error.message : "Unable to generate the voice update. Please retry."
      }));
    } finally {
      setVoiceRequestsByIncident((current) => ({ ...current, [incidentId]: undefined }));
    }
  };

  const activeCount = incidents.filter(i => i.status !== "Resolved").length;
  const selectedVoice = selectedIncident ? voiceByIncident[selectedIncident.id] : undefined;
  const selectedVoiceError = selectedIncident ? voiceErrorsByIncident[selectedIncident.id] : undefined;
  const selectedVoiceRequest = selectedIncident ? voiceRequestsByIncident[selectedIncident.id] : undefined;
  const selectedVoiceHydration = selectedIncident ? voiceHydrationByIncident[selectedIncident.id] === true : false;
  const selectedVoiceHydrationError = selectedIncident ? voiceHydrationErrorsByIncident[selectedIncident.id] : undefined;
  const isVoiceRequestRunning = selectedVoiceRequest !== undefined;
  const selectedBridgeApproval = selectedIncident
    ? approvals.find((approval) => isBridgeApprovalForIncident(approval, selectedIncident.id))
    : undefined;
  const selectedHumanSla = selectedIncident && selectedIncident.status !== "Resolved"
    ? selectedIncident.elapsedMinutes >= 30 ? "BREACHED" : "WITHIN TARGET"
    : selectedIncident ? "COMPLETED" : "UNKNOWN";
  const selectedTwinState = selectedIncident
    ? selectedIncident.assignedTo.includes("Twin") ? "TWIN ASSIGNED" : "WAITING FOR TWIN TAKEOVER"
    : "UNKNOWN";

  async function updateSidecarSla(minutes: number) {
    const response = await fetch("/api/servicenow/set-sla", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ minutes }) });
    if (response.ok) setSidecarSlaMinutes(minutes);
  }

  // Find asset health based on incidents
  const getAssetHealth = (cmdbItem: string) => {
    const activeOnAsset = incidents.find(i => i.cmdbItem === cmdbItem && i.status !== "Resolved");
    if (activeOnAsset) {
      return { status: "DEGRADED", color: "text-rose-500 border-rose-200 dark:border-rose-900/30 bg-rose-50/50 dark:bg-rose-950/10" };
    }
    return { status: "OPERATIONAL", color: "text-emerald-500 border-emerald-100 dark:border-emerald-950/20 bg-emerald-50/30 dark:bg-emerald-950/5" };
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-slate-50 dark:bg-[#050505] text-slate-800 dark:text-[#e0e0e0] transition-colors duration-200 h-screen">
      
      {/* ServiceNow Header Ribbon */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white dark:bg-[#0d0d0d] p-5 rounded border border-slate-200 dark:border-[#222] shadow-sm gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-emerald-600 rounded flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/10">
            <Server className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white uppercase tracking-wider">ServiceNow ITOM Console</h2>
              <span className="px-2 py-0.5 text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 rounded-full border border-emerald-200/40 dark:border-emerald-800/30 font-mono">CMDB SATELLITE ACTIVE</span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">Configuration Items (CI) monitoring, incident routing, and 30-min SRE Digital Twin SLA enforcement.</p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-stretch md:self-auto">
          {currentUser.role === UserRole.ADMIN && <button type="button" onClick={() => void resetSdwanDemoPack()} disabled={resettingDemoPack} className="p-2.5 rounded border border-violet-300 bg-violet-50 text-violet-700 transition-all flex items-center gap-1.5 text-xs font-semibold disabled:opacity-50 dark:border-violet-800 dark:bg-violet-950/30 dark:text-violet-300" title="Restore only the 10 simulated SD-WAN incidents"><RotateCcw className={`w-3.5 h-3.5 ${resettingDemoPack ? "animate-spin" : ""}`} />{resettingDemoPack ? "Restoring..." : "Reset SD-WAN demo"}</button>}
            <button onClick={() => setSidecarOpen(true)} className="p-2.5 bg-indigo-600 hover:bg-indigo-700 rounded border border-indigo-500 text-white transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer"><Layers className="w-3.5 h-3.5" /> Demo ServiceNow sidecar</button>
          <button
            onClick={() => onRefreshState()}
            className="p-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-[#1a1a1a] dark:hover:bg-[#222] rounded border border-slate-200 dark:border-[#2b2b2b] text-slate-600 dark:text-zinc-400 transition-all flex items-center gap-1.5 text-xs font-semibold cursor-pointer"
            title="Force refresh ServiceNow tables"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Synchronize DB
          </button>
        </div>
      </div>

      {demoResetMessage && <div role="status" className="rounded border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-800 dark:border-violet-900 dark:bg-violet-950/20 dark:text-violet-200">{demoResetMessage}</div>}

      {sidecarOpen && <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-indigo-200 bg-white shadow-2xl dark:border-indigo-900/50 dark:bg-[#0b0b0d]" aria-label="Demo ServiceNow sidecar">
        <div className="flex items-center justify-between border-b border-slate-200 p-4 dark:border-zinc-800"><div><h3 className="text-sm font-black uppercase tracking-wider text-slate-900 dark:text-white">Demo ServiceNow</h3><p className="mt-1 text-[10px] text-slate-500 dark:text-zinc-400">Queue, human SLA gate, takeover, and work notes</p></div><button type="button" onClick={() => setSidecarOpen(false)} className="rounded border border-slate-300 px-2 py-1 text-xs dark:border-zinc-700">Close</button></div>
        <div className="border-b border-slate-200 p-4 dark:border-zinc-800"><label className="grid gap-1 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">Human response SLA<select value={sidecarSlaMinutes} onChange={event => void updateSidecarSla(Number(event.target.value))} className="mt-1 rounded border border-slate-300 bg-white px-2 py-2 text-sm font-normal normal-case text-slate-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white">{[1, 5, 10, 15, 20, 30].map(value => <option key={value} value={value}>{value} minutes</option>)}</select></label><div className="mt-2 flex gap-2"><button type="button" disabled={!selectedIncident} onClick={() => selectedIncident && onAdvanceTime(5, selectedIncident.id)} className="flex-1 rounded border border-slate-300 px-2 py-2 text-xs disabled:opacity-40 dark:border-zinc-700">Advance selected +5m</button><button type="button" disabled={!selectedIncident} onClick={() => selectedIncident && onAdvanceTime(sidecarSlaMinutes, selectedIncident.id)} className="flex-1 rounded bg-indigo-600 px-2 py-2 text-xs text-white disabled:opacity-40">Trigger selected SLA</button></div></div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">{incidents.map(incident => <article key={incident.id} className={`rounded border p-3 ${selectedIncident?.id === incident.id ? "border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20" : "border-slate-200 dark:border-zinc-800"}`}><button type="button" onClick={() => setSelectedIncidentId(incident.id)} className="w-full text-left"><div className="flex items-start justify-between gap-2"><span className="font-mono text-[10px] font-bold text-slate-500 dark:text-zinc-400">{incident.id}</span><span className={`text-[9px] font-bold uppercase ${incident.status === "Resolved" ? "text-emerald-600" : incident.elapsedMinutes >= sidecarSlaMinutes ? "text-rose-600" : "text-amber-600"}`}>{incident.status === "Resolved" ? "RESOLVED" : `${incident.elapsedMinutes}/${sidecarSlaMinutes}m`}</span></div><p className="mt-2 text-xs font-bold text-slate-800 dark:text-zinc-200">{incident.shortDescription}</p><p className="mt-1 text-[10px] text-slate-500 dark:text-zinc-400">Owner: {incident.assignedTo}</p></button><div className="mt-2 flex gap-2"><button type="button" disabled={incident.status === "Resolved" || takingOver !== null} onClick={() => void takeOver(incident.id)} className="rounded bg-indigo-600 px-2 py-1.5 text-[10px] font-bold text-white disabled:opacity-40">{takingOver === incident.id ? "Investigating..." : incident.assignedTo.includes("Twin") ? "Retry investigation" : "Ask Twin to take over"}</button><button type="button" onClick={() => setSelectedIncidentId(incident.id)} className="rounded border border-slate-300 px-2 py-1.5 text-[10px] dark:border-zinc-700">Details</button></div>{selectedIncident?.id === incident.id && <form onSubmit={async event => { event.preventDefault(); const note=sidecarNote.trim(); if (!note) return; await onAddWorkNote(incident.id, note, `${currentUser.name} (Human)`); setSidecarNote(""); }} className="mt-3 flex gap-2"><input value={sidecarNote} onChange={event => setSidecarNote(event.target.value)} placeholder="Add work note..." className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950" /><button type="submit" className="rounded bg-slate-900 px-2 py-1.5 text-[10px] font-bold text-white dark:bg-zinc-700">Add note</button></form>}</article>)}</div>
      </aside>}

      {/* Main Grid: Left Assets, Right Incidents Dashboard */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column: CMDB Assets & Time Controls (4 Cols) */}
        <div className="lg:col-span-4 space-y-6">
          
          {/* Virtual SLA Time Accelerator */}
          <div className="bg-gradient-to-br from-indigo-500/5 to-purple-500/5 dark:from-indigo-600/5 dark:to-purple-600/5 bg-white dark:bg-[#0d0d0d] p-5 rounded border border-indigo-100 dark:border-indigo-900/30 shadow-sm space-y-4">
            <div className="flex items-center gap-2 pb-1.5 border-b border-slate-100 dark:border-[#222]">
              <Sliders className="w-4 h-4 text-indigo-500" />
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                Virtual SLA Clock Controls
              </h3>
            </div>

            <p className="text-[11px] leading-relaxed text-slate-500 dark:text-zinc-400 font-medium">
              Accelerate or simulate the passage of time to witness the **SRE Digital Twin** automatically seize tickets if a Human Engineer fails to log work notes within 30 minutes.
            </p>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => onAdvanceTime(5)}
                className="py-2 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-[#1a1a1a] dark:hover:bg-[#222] border border-slate-200 dark:border-[#2b2b2b] text-slate-700 dark:text-zinc-300 rounded text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5 text-blue-500" /> +5 Minutes
              </button>
              <button
                onClick={() => onAdvanceTime(30)}
                className="py-2 px-3 bg-[#4f46e5] hover:bg-[#4338ca] text-white rounded text-xs font-bold shadow-md shadow-[#4f46e5]/10 transition-all flex items-center justify-center gap-1.5 cursor-pointer border border-transparent"
              >
                <Clock className="w-3.5 h-3.5 text-white" /> +30 Mins (SLA!)
              </button>
            </div>

            <label className="flex items-center gap-2.5 bg-slate-50 dark:bg-[#060606] p-2.5 rounded border border-slate-200/50 dark:border-[#1e1e1e] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isLiveClockActive}
                onChange={(e) => setIsLiveClockActive(e.target.checked)}
                className="w-4 h-4 text-indigo-600 bg-slate-100 border-slate-300 rounded focus:ring-indigo-500 dark:bg-[#1a1a1a] dark:border-[#333]"
              />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-800 dark:text-zinc-200 flex items-center gap-1.5">
                  Real-time Simulation {isLiveClockActive && <span className="inline-block w-2 h-2 rounded-full bg-indigo-500 animate-ping" />}
                </span>
                <span className="text-[9px] text-slate-400 font-mono">1 real second = 1 virtual minute</span>
              </div>
            </label>
          </div>

          {/* CMDB Assets Section */}
          <div className="bg-white dark:bg-[#0d0d0d] p-5 rounded border border-slate-200 dark:border-[#222] shadow-sm space-y-4">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-[#222]">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-500" />
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Network CMDB Inventory
                </h3>
              </div>
              <span className="text-[10px] font-mono text-slate-400">CLASS: CI_HARDWARE</span>
            </div>

            <div className="space-y-3">
              {[
                {
                  id: "us-corp-wifi-controller",
                  label: "Wireless LAN Controller",
                  spec: "Cisco Catalyst 9800-80 • Firmware 17.9.4a",
                  loc: "HQ Server Room - Rack 4",
                  cat: "Wireless" as const,
                  icon: Wifi,
                  color: "text-sky-500 bg-sky-500/10"
                },
                {
                  id: "hq-core-switch-01",
                  label: "Core Switch Stack",
                  spec: "Cisco Catalyst 9500 Stack (4x Nodes) • 17.6.5",
                  loc: "IDF-A Core Closet - Rack 1",
                  cat: "Switch" as const,
                  icon: Server,
                  color: "text-indigo-500 bg-indigo-500/10"
                },
                {
                  id: "silverpeak-sdwan-branch-04",
                  label: "SD-WAN Edge Connect",
                  spec: "Silverpeak EC-XL-P • VXOA 9.2.4.0",
                  loc: "Chicago Branch - Rack 2",
                  cat: "SDWAN" as const,
                  icon: Layers,
                  color: "text-amber-500 bg-amber-500/10"
                }
              ].map((item) => {
                const health = getAssetHealth(item.id);
                const isDegraded = health.status === "DEGRADED";
                return (
                  <div 
                    key={item.id}
                    className={`p-3.5 rounded border transition-all ${health.color} ${
                      isDegraded ? "ring-1 ring-rose-400 dark:ring-rose-800/50 animate-pulse" : ""
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className={`p-1.5 rounded ${item.color}`}>
                          <item.icon className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-200 leading-none">
                            {item.label}
                          </h4>
                          <span className="text-[10px] text-slate-400 font-mono block mt-1">
                            {item.id}
                          </span>
                        </div>
                      </div>

                      <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border ${
                        isDegraded 
                          ? "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400" 
                          : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                      }`}>
                        {health.status}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1 text-[10px] text-slate-500 dark:text-zinc-400 border-t border-slate-100 dark:border-[#222]/30 pt-2 font-medium">
                      <p><span className="text-slate-400 font-normal">Details:</span> {item.spec}</p>
                      <p><span className="text-slate-400 font-normal">Location:</span> {item.loc}</p>
                    </div>

                    {!isDegraded && (
                      <button
                        onClick={() => onTriggerIncident(item.cat)}
                        className="w-full mt-3.5 py-1.5 px-3 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 border border-rose-200/50 dark:border-rose-900/30 text-rose-700 dark:text-rose-400 rounded text-[10px] font-bold tracking-wider transition-all flex items-center justify-center gap-1 uppercase cursor-pointer"
                      >
                        <AlertOctagon className="w-3.5 h-3.5 shrink-0" /> Trigger Critical P1 Alarm
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

        </div>

        {/* Right Column: ServiceNow Incident Lists & Timelines (8 Cols) */}
        <div className="lg:col-span-8 space-y-6">
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            
            {/* Incident Cards Column (Left of Right) */}
            <div className="space-y-4 flex flex-col">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-rose-500 animate-pulse" />
                  Active Incident Tickets ({activeCount})
                </h3>
              </div>

              {incidents.length === 0 ? (
                <div className="bg-white dark:bg-[#0d0d0d] p-8 text-center rounded border border-slate-200 dark:border-[#222] flex-1 flex flex-col items-center justify-center space-y-2">
                  <CheckCircle className="w-8 h-8 text-emerald-500" />
                  <h4 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wide">All Systems Nominal</h4>
                  <p className="text-[11px] text-slate-400 max-w-xs">No critical incident alerts are currently active in the ServiceNow pipeline. Trigger an alarm on the left to begin.</p>
                </div>
              ) : (
                <div className="space-y-3 overflow-y-auto max-h-[660px] pr-1">
                  {incidents.map((inc) => {
                    const isSelected = inc.id === selectedIncidentId;
                    const isSlaBreached = inc.elapsedMinutes >= 30;
                    const isTwinAssigned = inc.assignedTo.includes("Twin");
                    const isResolved = inc.status === "Resolved";

                    return (
                      <div
                        key={inc.id}
                        onClick={() => setSelectedIncidentId(inc.id)}
                        className={`p-4 rounded border transition-all cursor-pointer text-left relative ${
                          isResolved
                            ? "bg-slate-100/60 dark:bg-zinc-900/10 border-slate-200 dark:border-zinc-900 text-slate-500"
                            : isSelected
                            ? "bg-white dark:bg-[#0e0e0e] border-indigo-500 ring-1 ring-indigo-500/20"
                            : "bg-white dark:bg-[#0d0d0d] border-slate-200 dark:border-[#222] hover:border-slate-300 dark:hover:border-zinc-700"
                        }`}
                      >
                        {/* Selected Indicator Bar */}
                        {isSelected && (
                          <div className="absolute top-0 bottom-0 left-0 w-1 bg-[#4f46e5] rounded-l" />
                        )}

                        <div className="flex justify-between items-start gap-2">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] font-black font-mono tracking-wider text-slate-950 dark:text-white uppercase">
                                {inc.id}
                              </span>
                              <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-zinc-800 text-slate-500 border border-slate-200/40 dark:border-zinc-700 uppercase font-mono">
                                {inc.category}
                              </span>
                            </div>
                            <span className="text-[9px] text-slate-400 font-mono block">
                              Opened: {new Date(inc.openedAt).toLocaleTimeString()}
                            </span>
                          </div>

                          <div className="flex flex-col items-end gap-1 shrink-0">
                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded border tracking-widest ${
                              isResolved 
                                ? "bg-slate-100 text-slate-400 dark:bg-zinc-950 border-slate-200 dark:border-zinc-800"
                                : "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400 animate-pulse"
                            }`}>
                              {inc.severity}
                            </span>
                          </div>
                        </div>

                        <p className={`text-xs font-bold leading-tight mt-3 ${isResolved ? "text-slate-400 line-through" : "text-slate-800 dark:text-zinc-200"}`}>
                          {inc.shortDescription}
                        </p>

                        {/* Owner Badge */}
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 bg-slate-50 dark:bg-[#060606] p-2 rounded border border-slate-200/30 dark:border-zinc-900/50">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold">
                            {isTwinAssigned ? (
                              <>
                                <Bot className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                                <span className="text-indigo-600 dark:text-indigo-400 truncate max-w-[130px]">AI: Apex-NRE-Twin</span>
                              </>
                            ) : inc.assignedTo === "Unassigned" ? (
                              <>
                                <User className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                                <span className="text-rose-500 animate-pulse uppercase tracking-wider text-[9px]">Unassigned</span>
                              </>
                            ) : (
                              <>
                                <UserCheck className="w-3.5 h-3.5 text-slate-600 dark:text-zinc-400 shrink-0" />
                                <span className="text-slate-700 dark:text-zinc-300 truncate max-w-[130px]">{inc.assignedTo}</span>
                              </>
                            )}
                          </div>

                          <span className={`text-[10px] font-mono font-bold ${isResolved ? "text-emerald-500" : isSlaBreached ? "text-indigo-500" : "text-slate-500"}`}>
                            {isResolved ? "RESOLVED" : `IDLE: ${inc.elapsedMinutes} mins`}
                          </span>
                        </div>

                        {/* SLA Countdown Bar */}
                        {!isResolved && !isTwinAssigned && (
                          <div className="mt-3.5 space-y-1">
                            <div className="flex justify-between text-[8px] font-bold text-slate-400 uppercase tracking-widest font-mono">
                              <span>SLA Timeout Gate</span>
                              <span className={inc.elapsedMinutes >= 25 ? "text-rose-500 font-black animate-pulse" : ""}>
                                {30 - inc.elapsedMinutes > 0 ? `${30 - inc.elapsedMinutes}m to AI pickup` : "SLA BREACHED"}
                              </span>
                            </div>
                            <div className="w-full h-1 bg-slate-100 dark:bg-zinc-800/60 rounded-full overflow-hidden">
                              <div 
                                className={`h-full rounded-full transition-all duration-300 ${
                                  inc.elapsedMinutes >= 25 ? "bg-rose-500 animate-pulse" : inc.elapsedMinutes >= 15 ? "bg-amber-500" : "bg-blue-500"
                                }`}
                                style={{ width: `${Math.min(100, (inc.elapsedMinutes / 30) * 100)}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {isTwinAssigned && !isResolved && (
                          <div className="mt-3 px-2 py-1 bg-indigo-50 dark:bg-indigo-950/20 rounded border border-indigo-100 dark:border-indigo-900/30 flex items-center justify-between text-[9px] font-black tracking-wider uppercase text-indigo-700 dark:text-indigo-400">
                            <span className="flex items-center gap-1.5"><Bot className="w-3 h-3 animate-spin" /> AI TWIN MITIGATING OUTAGE</span>
                            <span className="font-mono">SLA TRIGGERED</span>
                          </div>
                        )}
                        <div className="mt-3 flex gap-2"><button type="button" onClick={(event) => { event.stopPropagation(); openIncidentDetails(inc.id); }} className="min-w-0 flex-1 rounded border border-indigo-200 bg-indigo-50 px-2 py-1.5 text-[9px] font-black uppercase tracking-wider text-indigo-700 hover:bg-indigo-100 dark:border-indigo-900/40 dark:bg-indigo-950/20 dark:text-indigo-300 dark:hover:bg-indigo-950/40">Open incident details</button>{onOpenInvestigation && <button type="button" onClick={(event) => { event.stopPropagation(); onOpenInvestigation(inc.id); }} className="rounded bg-blue-600 px-2 py-1.5 text-[9px] font-black uppercase tracking-wider text-white">Open investigation</button>}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Selected Incident Details Timeline (Right of Right) */}
            <div ref={incidentDetailsRef} className="bg-white dark:bg-[#0d0d0d] rounded border border-slate-200 dark:border-[#222] p-5 flex flex-col h-full min-h-[500px] scroll-mt-6">
              
              {selectedIncident ? (
                <div className="flex flex-col h-full flex-1 min-h-0">
                  
                  {/* Selected Header */}
                  <div className="pb-4 border-b border-slate-100 dark:border-[#222] space-y-1.5">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-black font-mono tracking-wider text-slate-900 dark:text-white uppercase flex items-center gap-1.5">
                        <History className="w-4 h-4 text-emerald-500" />
                        {selectedIncident.id}
                      </h4>
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded border ${
                        selectedIncident.status === "Resolved"
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                          : selectedIncident.status === "In Progress"
                          ? "bg-blue-500/10 border-blue-500/20 text-blue-600 dark:text-blue-400 animate-pulse"
                          : "bg-rose-500/10 border-rose-500/20 text-rose-600 dark:text-rose-400 animate-pulse"
                      }`}>
                        {selectedIncident.status}
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-700 dark:text-zinc-200">
                      {selectedIncident.shortDescription}
                    </p>
                    <div className="text-[10px] text-slate-400 font-mono flex flex-wrap gap-x-4 gap-y-1 pt-1.5">
                      <span><strong className="text-slate-500 dark:text-zinc-500">Asset:</strong> {selectedIncident.cmdbName}</span>
                    </div>
                  </div>

                  <section aria-label="Incident SLA and XLA comparison" className="mt-4 rounded border border-indigo-200/70 bg-indigo-50/40 p-3 dark:border-indigo-900/40 dark:bg-indigo-950/10">
                    <div className="flex items-center justify-between gap-2"><h5 className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-900 dark:text-white">SLA / XLA visibility</h5><span className="text-[8px] font-mono uppercase tracking-widest text-slate-500 dark:text-zinc-400">Incident detail</span></div>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="rounded border border-slate-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-[#080808]"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Human engineer pickup SLA</p><p className={`mt-1 text-sm font-black ${selectedHumanSla === "BREACHED" ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>{selectedHumanSla}</p><p className="mt-1 text-[10px] text-slate-500 dark:text-zinc-400">30-minute target · {selectedIncident.elapsedMinutes} virtual minutes elapsed</p></div>
                      <div className="rounded border border-slate-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-[#080808]"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Digital Twin response</p><p className="mt-1 text-sm font-black text-indigo-600 dark:text-indigo-400">{selectedTwinState}</p><p className="mt-1 text-[10px] text-slate-500 dark:text-zinc-400">Owner: {selectedIncident.assignedTo}</p></div>
                      <div className="rounded border border-slate-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-[#080808]"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Human resolution SLA</p><p className="mt-1 text-sm font-black text-slate-700 dark:text-zinc-200">{selectedIncident.status === "Resolved" ? "RESOLVED" : "OPEN"}</p><p className="mt-1 text-[10px] text-slate-500 dark:text-zinc-400">Resolution timing is recorded in the ticket timeline.</p></div>
                      <div className="rounded border border-slate-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-[#080808]"><p className="text-[8px] font-black uppercase tracking-widest text-slate-400">Customer journey XLA</p><p className="mt-1 text-sm font-black text-amber-600 dark:text-amber-400">NOT MEASURED</p><p className="mt-1 text-[10px] text-slate-500 dark:text-zinc-400">Technical response speed does not prove user impact. Open XLA telemetry for journey evidence.</p></div>
                    </div>
                  </section>

                  <IncidentSpeechPanel key={selectedIncident.id} incidentId={selectedIncident.id} />
                  <AgentCollaborationPanel key={`agents-${selectedIncident.id}`} incidentId={selectedIncident.id} canInvestigate={[UserRole.ADMIN, UserRole.DEVOPS, UserRole.NRE].includes(currentUser.role)} />
                  {/* Region-aware Digital Twin voice update */}
                  <section
                    className="mt-4 rounded border border-indigo-200/70 bg-indigo-50/35 p-3.5 dark:border-indigo-900/40 dark:bg-indigo-950/10"
                    aria-labelledby={`voice-update-${selectedIncident.id}`}
                    aria-busy={isVoiceRequestRunning || selectedVoiceHydration}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2.5">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <span className="mt-0.5 rounded border border-indigo-200 bg-white p-1.5 text-indigo-600 shadow-sm dark:border-indigo-900/60 dark:bg-[#111] dark:text-indigo-400">
                          <Languages className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                          <h5
                            id={`voice-update-${selectedIncident.id}`}
                            className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-900 dark:text-white"
                          >
                            Multilingual voice update
                          </h5>
                          <p className="mt-0.5 text-[9px] leading-relaxed text-slate-500 dark:text-zinc-400">
                            Digital Twin routes ticket context to a local voice model. ServiceNow audit notes remain English.
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 rounded border border-blue-200 bg-white px-2 py-1 text-[8px] font-black uppercase tracking-widest text-blue-700 dark:border-blue-900/50 dark:bg-[#111] dark:text-blue-400">
                        Local synthesis
                      </span>
                    </div>

                    <div
                      className="mt-3 min-h-4 text-[9px] font-bold text-indigo-700 dark:text-indigo-300"
                      aria-live="polite"
                      aria-atomic="true"
                    >
                      {!selectedVoiceRequest && selectedVoiceHydration && (
                        <span className="flex items-center gap-1.5 text-slate-500 dark:text-zinc-400">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          Checking for a saved voice update…
                        </span>
                      )}
                      {selectedVoiceRequest === "preview" && (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          Translating and generating local voice preview…
                        </span>
                      )}
                      {selectedVoiceRequest === "bridge" && (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                          Regenerating audio and publishing to the bridge…
                        </span>
                      )}
                      {!selectedVoiceRequest && !selectedVoiceHydration && selectedVoice && (
                        <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                          <CheckCircle className="h-3 w-3" aria-hidden="true" />
                          Voice update ready for {selectedVoice.region} stakeholders.
                        </span>
                      )}
                      {!selectedVoiceRequest && !selectedVoiceHydration && !selectedVoice && !selectedVoiceError && (
                        <span className="text-slate-500 dark:text-zinc-500">No localized audio has been generated for this incident.</span>
                      )}
                    </div>

                    {selectedVoiceError && (
                      <motion.div
                        initial={{ opacity: 0, y: -3 }}
                        animate={{ opacity: 1, y: 0 }}
                        role="alert"
                        className="mt-2 flex items-start gap-2 rounded border border-rose-200 bg-rose-50 p-2.5 text-[10px] font-semibold leading-relaxed text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300"
                      >
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        <span>{selectedVoiceError}</span>
                      </motion.div>
                    )}

                    {!selectedVoiceError && selectedVoiceHydrationError && (
                      <p
                        role="status"
                        className="mt-2 flex items-start gap-1.5 text-[8px] font-medium leading-relaxed text-slate-500 dark:text-zinc-500"
                      >
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden="true" />
                        <span>Saved preview could not be refreshed: {selectedVoiceHydrationError}</span>
                      </p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleVoiceUpdate(selectedIncident.id, false)}
                        disabled={isVoiceRequestRunning}
                        title="Generate a localized WAV preview for this incident"
                        className="inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded border border-indigo-600 bg-indigo-600 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-white shadow-sm transition-colors hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:focus:ring-offset-[#0d0d0d]"
                      >
                        {selectedVoiceRequest === "preview" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        {selectedVoiceRequest === "preview" ? "Generating…" : selectedVoice ? "Regenerate preview" : "Generate voice preview"}
                      </button>

                      {selectedVoice && (
                        <button
                          type="button"
                          onClick={() => handleVoiceUpdate(selectedIncident.id, true)}
                          disabled={isVoiceRequestRunning || !selectedBridgeApproval}
                          title={selectedBridgeApproval
                            ? "Regenerate and publish this localized update to the approved Teams or Webex bridge"
                            : "Exact incident/workflow approval required before bridge publishing"}
                          className="inline-flex min-h-8 flex-1 items-center justify-center gap-1.5 rounded border border-amber-300 bg-white px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-amber-800 shadow-sm transition-colors hover:bg-amber-50 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-900/60 dark:bg-[#111] dark:text-amber-400 dark:hover:bg-amber-950/20 dark:focus:ring-offset-[#0d0d0d]"
                        >
                          {selectedVoiceRequest === "bridge" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          ) : (
                            <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                          )}
                          {selectedVoiceRequest === "bridge" ? "Publishing…" : "Regenerate + publish"}
                        </button>
                      )}
                    </div>

                    {selectedVoice && (
                      selectedBridgeApproval?.workflowId ? (
                        <p className="mt-2 break-words text-[8px] font-semibold leading-relaxed text-emerald-700 dark:text-emerald-400">
                          Bridge gate bound to approval <code className="font-mono">{selectedBridgeApproval.id}</code>
                          {" · "}workflow <code className="font-mono">{selectedBridgeApproval.workflowId}</code>
                          {" · "}incident <code className="font-mono">{selectedIncident.id}</code>
                        </p>
                      ) : (
                        <p className="mt-2 flex items-start gap-1.5 text-[9px] font-semibold leading-relaxed text-amber-700 dark:text-amber-400">
                          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>Exact incident/workflow approval required before publishing to Teams or Webex.</span>
                        </p>
                      )
                    )}

                    <AnimatePresence mode="wait">
                      {selectedVoice && (
                        <motion.div
                          key={`${selectedIncident.id}-${selectedVoice.generatedAt}`}
                          initial={{ opacity: 0, y: 5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -3 }}
                          transition={{ duration: 0.18 }}
                          className="mt-3 space-y-3 border-t border-indigo-100 pt-3 dark:border-indigo-900/30"
                        >
                          <div
                            className="flex flex-wrap items-center gap-1.5 rounded border border-slate-200 bg-white p-2 font-mono text-[9px] font-bold text-slate-700 dark:border-zinc-800 dark:bg-[#080808] dark:text-zinc-300"
                            aria-label={`Voice routing: ${selectedVoice.region}, ${selectedVoice.languageCode}, ${selectedVoice.modelName}`}
                          >
                            <span className="rounded bg-indigo-50 px-1.5 py-1 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">
                              {selectedVoice.region}
                            </span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-slate-300" aria-hidden="true" />
                            <span className="rounded bg-blue-50 px-1.5 py-1 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                              {selectedVoice.languageCode}
                            </span>
                            <ArrowRight className="h-3 w-3 shrink-0 text-slate-300" aria-hidden="true" />
                            <code className="min-w-0 break-all rounded bg-slate-100 px-1.5 py-1 text-[8px] text-slate-600 dark:bg-zinc-900 dark:text-zinc-400">
                              {selectedVoice.modelName}
                            </code>
                          </div>

                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="min-w-0">
                              <span className="block text-[8px] font-black uppercase tracking-widest text-slate-400">Bridge status</span>
                              <span className={`mt-1 inline-flex max-w-full break-all rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold ${getBridgeStatusClass(selectedVoice.bridgeStatus)}`}>
                                {selectedVoice.bridgeStatus}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <span className="block text-[8px] font-black uppercase tracking-widest text-slate-400">English audit</span>
                              <span className={`mt-1 inline-flex max-w-full break-all rounded border px-1.5 py-0.5 font-mono text-[8px] font-bold ${getAuditStatusClass(selectedVoice.auditStatus)}`}>
                                {selectedVoice.auditStatus}
                              </span>
                            </div>
                          </div>

                          <div className="rounded border border-slate-200 bg-white p-2.5 dark:border-zinc-800 dark:bg-[#080808]">
                            <div className="flex items-center justify-between gap-2">
                              <span className="flex items-center gap-1.5 text-[8px] font-black uppercase tracking-widest text-slate-400">
                                <Headphones className="h-3 w-3 text-indigo-500" aria-hidden="true" /> Localized stakeholder message
                              </span>
                              <time className="shrink-0 font-mono text-[8px] text-slate-400" dateTime={selectedVoice.generatedAt}>
                                {new Date(selectedVoice.generatedAt).toLocaleString()}
                              </time>
                            </div>
                            <p
                              lang={selectedVoice.languageCode}
                              className="mt-2 whitespace-pre-wrap break-words text-[10px] font-medium leading-relaxed text-slate-700 dark:text-zinc-300"
                            >
                              {selectedVoice.translatedSummary}
                            </p>
                            <audio
                              key={`${selectedVoice.audioUrl}-${selectedVoice.generatedAt}`}
                              controls
                              preload="metadata"
                              src={selectedVoice.audioUrl}
                              aria-label={`Localized voice update for ${selectedIncident.id} in ${selectedVoice.languageCode}`}
                              className="mt-2.5 h-8 w-full"
                            >
                              Your browser does not support WAV audio playback.
                            </audio>
                          </div>

                          {selectedVoice.message && (
                            <p className="text-[9px] font-medium leading-relaxed text-slate-500 dark:text-zinc-400">
                              {selectedVoice.message}
                            </p>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </section>

                  {/* Incident Worknotes Timeline */}
                  <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 min-h-[220px]">
                    <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest pb-1 border-b border-slate-100/50 dark:border-[#222]/30 mb-3">
                      <History className="w-3.5 h-3.5 text-indigo-500" /> Ticket Work Notes & Audit Log
                    </div>

                    <div className="relative pl-4 border-l border-slate-200 dark:border-[#222] space-y-4">
                      {selectedIncident.workNotes.map((note, index) => {
                        const isTwin = note.author.includes("Twin");
                        const isSystem = note.author.includes("System") || note.author.includes("Monitor") || note.author.includes("Webhook") || note.author.includes("Syslog");

                        return (
                          <div key={index} className="relative space-y-1">
                            {/* Bullet icon */}
                            <span className={`absolute -left-[22.5px] top-0.5 p-0.5 rounded-full ring-4 ring-white dark:ring-[#0d0d0d] ${
                              isTwin 
                                ? "bg-indigo-500 text-white" 
                                : isSystem 
                                ? "bg-rose-500 text-white" 
                                : "bg-slate-400 text-white"
                            }`}>
                              {isTwin ? (
                                <Bot className="w-2.5 h-2.5" />
                              ) : isSystem ? (
                                <Activity className="w-2.5 h-2.5" />
                              ) : (
                                <User className="w-2.5 h-2.5" />
                              )}
                            </span>

                            <div className="flex items-center justify-between text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                              <span className={isTwin ? "text-indigo-600 dark:text-indigo-400" : "text-slate-500 dark:text-zinc-300"}>
                                {note.author}
                              </span>
                              <span className="font-mono">{new Date(note.timestamp).toLocaleTimeString()}</span>
                            </div>

                            <p className="text-[11px] leading-relaxed font-medium bg-slate-50/50 dark:bg-zinc-900/40 border border-slate-200/20 dark:border-zinc-800/40 p-2.5 rounded text-slate-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
                              {note.text}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Add Work Note Form */}
                  {selectedIncident.status !== "Resolved" && (
                    <form 
                      onSubmit={handleAddNoteSubmit}
                      className="border-t border-slate-100 dark:border-[#222] pt-4 mt-auto space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <label className="block text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-widest">
                          Log Human Engineer Work Note
                        </label>
                        <span className="text-[8px] font-mono text-emerald-500 uppercase font-black tracking-wider animate-pulse flex items-center gap-1">
                          <Sliders className="w-2.5 h-2.5" /> Resets idle timer to 0
                        </span>
                      </div>
                      
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newWorkNoteText}
                          onChange={(e) => setNewWorkNoteText(e.target.value)}
                          placeholder="e.g. Initiating physical diagnostics on fiber trunk lines..."
                          className="flex-1 bg-white dark:bg-[#0d0d0d] border border-slate-200 dark:border-[#222] rounded py-1.5 px-3 text-xs text-slate-800 dark:text-zinc-300 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#4f46e5] focus:border-[#4f46e5]"
                          disabled={isSubmittingNote}
                        />
                        <button
                          type="submit"
                          disabled={isSubmittingNote || !newWorkNoteText.trim()}
                          className="bg-slate-900 hover:bg-slate-800 dark:bg-indigo-600 dark:hover:bg-indigo-700 text-white px-3 py-1.5 rounded disabled:opacity-40 transition-colors cursor-pointer text-xs font-bold flex items-center gap-1.5 border border-transparent"
                        >
                          <Send className="w-3 h-3" /> Log
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Resolve Ticket Button if not resolved */}
                  {selectedIncident.status !== "Resolved" && (
                    <div className="pt-3">
                      <button
                        type="button"
                        disabled={resolvingIncident !== null}
                        onClick={async () => {
                          const incidentId = selectedIncident.id;
                          setResolvingIncident(incidentId);
                          setResolutionMessage(null);
                          try {
                            await onResolveIncident(incidentId);
                            setResolutionMessage({ incidentId, kind: "SUCCESS", text: "Ticket resolved and recorded in the incident ledger." });
                          } catch (error) {
                            setResolutionMessage({ incidentId, kind: "ERROR", text: error instanceof Error ? error.message : "Unable to resolve this incident." });
                          } finally {
                            setResolvingIncident(null);
                          }
                        }}
                        className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-xs font-bold tracking-wider transition-all flex items-center justify-center gap-1.5 uppercase cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {resolvingIncident === selectedIncident.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5 shrink-0" />}
                        {resolvingIncident === selectedIncident.id ? "Recording resolution..." : "Mark Ticket Resolved"}
                      </button>
                    </div>
                  )}
                  {resolutionMessage?.incidentId === selectedIncident.id && (
                    <p role="status" className={`mt-2 rounded border px-3 py-2 text-[10px] ${resolutionMessage.kind === "SUCCESS" ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300" : "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300"}`}>
                      {resolutionMessage.text}
                    </p>
                  )}

                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-slate-400 space-y-2">
                  <HelpCircle className="w-12 h-12 text-slate-300 dark:text-zinc-700 animate-pulse" />
                  <p className="text-xs font-semibold uppercase tracking-wide">No Ticket Selected</p>
                  <p className="text-[10px] max-w-xs leading-normal">Select an incident from the active alerts panel to view its full work notes history and log human engineer updates.</p>
                </div>
              )}

            </div>

          </div>

        </div>

      </div>

    </div>
  );
}
