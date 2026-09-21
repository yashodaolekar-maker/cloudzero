import React, { useState, useEffect } from "react";
import { 
  CrossSiloWorkflow, 
  A2AMessage, 
  DepartmentType, 
  DigitalTwinAgent, 
  SSOUser, 
  HITLApproval 
  ,OperatingMode
} from "../types";
import { 
  Network, 
  ArrowRightLeft, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle, 
  Server, 
  Database as DbIcon, 
  Layers, 
  Cloud, 
  Terminal, 
  Clock, 
  Send, 
  RefreshCw, 
  Check, 
  ExternalLink,
  ChevronRight,
  Info,
  Sliders,
  Sparkles,
  Zap,
  Search,
  Play,
  Pause,
  RotateCcw,
  Copy,
  CheckSquare,
  FileCode,
  Activity,
  CheckCheck
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import A2ADemoWorkspace from "./A2ADemoWorkspace";

interface CrossSiloWorkflowViewProps {
  currentUser: SSOUser;
  agents: DigitalTwinAgent[];
  crossSiloWorkflows: CrossSiloWorkflow[];
  approvals: HITLApproval[];
  setActiveTab: (tab: string) => void;
  onRefreshState: () => void;
  operatingMode: OperatingMode;
}

export default function CrossSiloWorkflowView(props: CrossSiloWorkflowViewProps) {
  const [legacy, setLegacy] = useState(false);
  return <div className="flex-1 min-w-0 h-screen overflow-y-auto bg-slate-50 dark:bg-[#050505] p-4 md:p-8 space-y-4">
    <nav aria-label="A2A workspace mode" className="flex flex-wrap gap-2 text-sm">
      <button className={`rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 ${!legacy ? "bg-blue-600 text-white" : "text-slate-600 dark:text-zinc-300"}`} onClick={() => setLegacy(false)}>Database investigation lab</button>
      <button className={`rounded px-3 py-2 focus:ring-2 focus:ring-blue-500 ${legacy ? "bg-blue-600 text-white" : "text-slate-600 dark:text-zinc-300"}`} onClick={() => setLegacy(true)}>Legacy scripted walkthrough</button>
    </nav>
    {legacy ? <><p className="border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">Prewritten illustrative walkthrough. These historical scripts are not database observations. Legacy execution controls are disabled; use the database investigation lab to run an observable investigation.</p><fieldset disabled className="min-w-0"><LegacyCrossSiloWorkflowView {...props} /></fieldset></> : <A2ADemoWorkspace />}
  </div>;
}

function LegacyCrossSiloWorkflowView({
  currentUser,
  agents,
  crossSiloWorkflows,
  approvals,
  setActiveTab,
  onRefreshState,
  operatingMode
}: CrossSiloWorkflowViewProps) {
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(
    crossSiloWorkflows[0]?.id || "csw-win-net-001"
  );
  const [triggeringScenario, setTriggeringScenario] = useState(false);
  const [activeTabSub, setActiveTabSub] = useState<"dialogue" | "matrix" | "interactive-query">("dialogue");

  // Live Action / Remediation Execution State
  const [remediationExecuting, setRemediationExecuting] = useState(false);
  const [remediationMode, setRemediationMode] = useState<"idle" | "dry-run" | "live-apply">("idle");
  const [remediationLogs, setRemediationLogs] = useState<string[]>([]);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [actionSuccessBanner, setActionSuccessBanner] = useState<string | null>(null);

  // Stepper / Dialogue Walkthrough State
  const [simPlaying, setSimPlaying] = useState(false);
  const [visibleDialogueCount, setVisibleDialogueCount] = useState<number>(999);

  // Custom A2A Query Terminal State
  const [fromDept, setFromDept] = useState<DepartmentType>("Windows");
  const [toDept, setToDept] = useState<DepartmentType>("Network");
  const [queryType, setQueryType] = useState<A2AMessage["queryType"]>("MAINTENANCE_CHECK");
  const [customSubject, setCustomSubject] = useState("");
  const [customNotes, setCustomNotes] = useState("");
  const [sendingQuery, setSendingQuery] = useState(false);
  const [liveQueryResponses, setLiveQueryResponses] = useState<A2AMessage[]>([]);

  const activeWorkflow = crossSiloWorkflows.find(w => w.id === selectedWorkflowId) || crossSiloWorkflows[0];

  // Auto-step through dialogue simulation if playing
  useEffect(() => {
    let timer: any;
    if (simPlaying && activeWorkflow) {
      if (visibleDialogueCount < activeWorkflow.dialogue.length) {
        timer = setTimeout(() => {
          setVisibleDialogueCount(prev => prev + 1);
        }, 1400);
      } else {
        setSimPlaying(false);
      }
    }
    return () => clearTimeout(timer);
  }, [simPlaying, visibleDialogueCount, activeWorkflow]);

  const handleStartSim = () => {
    setVisibleDialogueCount(1);
    setSimPlaying(true);
  };

  const handleShowAllDialogue = () => {
    setSimPlaying(false);
    setVisibleDialogueCount(999);
  };

  const handleTriggerScenario = async (scenarioKey: string) => {
    setTriggeringScenario(true);
    setRemediationLogs([]);
    setActionSuccessBanner(null);
    try {
      const res = await fetch("/api/a2a/trigger-scenario", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenarioKey })
      });
      if (res.ok) {
        const data = await res.json();
        onRefreshState();
        if (data.workflow) {
          setSelectedWorkflowId(data.workflow.id);
          setVisibleDialogueCount(999);
        }
      }
    } catch (e) {
      console.error("Failed to trigger scenario:", e);
    } finally {
      setTriggeringScenario(false);
    }
  };

  const handleExecuteRemediation = async (mode: "dry-run" | "live-apply") => {
    if (!activeWorkflow) return;
    setRemediationExecuting(true);
    setRemediationMode(mode);
    setActionSuccessBanner(null);

    try {
      const res = await fetch("/api/a2a/execute-remediation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflowId: activeWorkflow.id,
          mode,
          executedBy: currentUser?.name || "L3/L4 Operator"
        })
      });

      if (res.ok) {
        const data = await res.json();
        setRemediationLogs(data.logs || []);
        setActionSuccessBanner(
          mode === "dry-run"
            ? "Pre-Flight Dry Run Completed: Syntax verified, 0 blast radius conflicts."
            : "Live Remediation Deployed: Action applied and peer verification complete!"
        );
        onRefreshState();
      } else {
        const err = await res.json();
        alert(err.error || "Failed to execute remediation");
      }
    } catch (e) {
      console.error("Execution failed:", e);
      alert("Network error executing live action");
    } finally {
      setRemediationExecuting(false);
      setRemediationMode("idle");
    }
  };

  const handleResetWorkflow = async () => {
    if (!activeWorkflow) return;
    try {
      const res = await fetch("/api/a2a/reset-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowId: activeWorkflow.id })
      });
      if (res.ok) {
        setRemediationLogs([]);
        setActionSuccessBanner(null);
        setVisibleDialogueCount(999);
        onRefreshState();
      }
    } catch (e) {
      console.error("Failed to reset workflow:", e);
    }
  };

  const handleSendCustomQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setSendingQuery(true);
    try {
      const res = await fetch("/api/a2a/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromDepartment: fromDept,
          toDepartment: toDept,
          queryType,
          subject: customSubject.trim() || undefined,
          notes: customNotes.trim() || undefined
          ,workflowId: activeWorkflow?.id,
          incidentId: activeWorkflow?.incidentId
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.message) {
          setLiveQueryResponses(prev => [data.message, ...prev]);
        }
      }
    } catch (e) {
      console.error("Failed to send A2A query:", e);
    } finally {
      setSendingQuery(false);
    }
  };

  const getDepartmentColor = (dept: DepartmentType) => {
    switch (dept) {
      case "Windows":
        return {
          bg: "bg-sky-50 dark:bg-sky-950/40",
          border: "border-sky-300 dark:border-sky-800",
          text: "text-sky-700 dark:text-sky-300",
          badge: "bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200"
        };
      case "Network":
        return {
          bg: "bg-blue-50 dark:bg-blue-950/40",
          border: "border-blue-300 dark:border-blue-800",
          text: "text-blue-700 dark:text-blue-300",
          badge: "bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200"
        };
      case "Linux":
        return {
          bg: "bg-amber-50 dark:bg-amber-950/40",
          border: "border-amber-300 dark:border-amber-800",
          text: "text-amber-700 dark:text-amber-300",
          badge: "bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200"
        };
      case "Database":
        return {
          bg: "bg-emerald-50 dark:bg-emerald-950/40",
          border: "border-emerald-300 dark:border-emerald-800",
          text: "text-emerald-700 dark:text-emerald-300",
          badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
        };
      case "Middleware":
        return {
          bg: "bg-purple-50 dark:bg-purple-950/40",
          border: "border-purple-300 dark:border-purple-800",
          text: "text-purple-700 dark:text-purple-300",
          badge: "bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200"
        };
      case "CloudOps":
        return {
          bg: "bg-teal-50 dark:bg-teal-950/40",
          border: "border-teal-300 dark:border-teal-800",
          text: "text-teal-700 dark:text-teal-300",
          badge: "bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200"
        };
      default:
        return {
          bg: "bg-slate-50 dark:bg-slate-900",
          border: "border-slate-300 dark:border-slate-700",
          text: "text-slate-700 dark:text-slate-300",
          badge: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200"
        };
    }
  };

  const pendingL3Approval = approvals.find(
    a => a.id === "hitl-nre-cross-002" && a.status === "PENDING"
  );

  const departments: { name: DepartmentType; icon: any; twin: string; desc: string }[] = [
    { name: "Windows", icon: Server, twin: "WinOps-Twin", desc: "Active Directory, Kerberos, DNS, Group Policy, IIS, WSUS/SCCM" },
    { name: "Network", icon: Network, twin: "Apex-NRE-Twin", desc: "Arista/Cisco, ACI Fabric, BGP/OSPF, VLANs, NGFWs, Decomm" },
    { name: "Linux", icon: Terminal, twin: "Tux-Linux-Twin", desc: "RHEL/Ubuntu, systemd, kpatch live-patching, SELinux, cron" },
    { name: "Database", icon: DbIcon, twin: "DataCore-DB-Twin", desc: "PostgreSQL HA, Oracle RAC, connection poolers, replication" },
    { name: "Middleware", icon: Layers, twin: "Nexus-Middleware-Twin", desc: "Kafka, RabbitMQ, Tomcat/WebLogic, Enterprise PKI / TLS" },
    { name: "CloudOps", icon: Cloud, twin: "Aether-CloudOps-Twin", desc: "AWS/Azure ExpressRoute, Kubernetes, Terraform, Decomm" }
  ];

  return (
    <div id="cross-silo-orchestrator-view" className="h-full overflow-y-auto p-6 space-y-6">
      
      {/* Top Banner Header */}
      <div className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-blue-600/10 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400 rounded-xl">
                <ArrowRightLeft className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                Top-Layer Cross-Department A2A Orchestrator
              </h2>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                Federated Digital Twin Mesh
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-3xl leading-relaxed">
              Unifies <strong className="text-slate-800 dark:text-zinc-200">Windows, Linux, Database, Network, Middleware, and CloudOps</strong> through autonomous Agent-to-Agent (A2A) protocol. When an issue surfaces in any silo, peer digital twins cross-verify active maintenance, decommissions, patching, DNS records, and socket connectivity in sub-seconds.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="px-3 py-1.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/80 rounded-xl flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300 font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>A2A Protocol: gRPC / Event Bus (Active)</span>
            </div>
          </div>
        </div>

        {/* 6 Connected Department Twins Bar */}
        <div className="mt-6 pt-5 border-t border-slate-100 dark:border-[#1a1a1a] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {departments.map((dept) => {
            const colors = getDepartmentColor(dept.name);
            const Icon = dept.icon;
            const isInitiator = activeWorkflow?.initiatingDepartment === dept.name;
            return (
              <div 
                key={dept.name}
                className={`p-3 rounded-xl border transition-all ${colors.bg} ${colors.border} ${
                  isInitiator ? "ring-2 ring-blue-500/50 shadow-sm" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="p-1.5 rounded-lg bg-white/80 dark:bg-black/40 border border-slate-200 dark:border-white/10">
                    <Icon className={`w-3.5 h-3.5 ${colors.text}`} />
                  </div>
                  <span className="text-[10px] font-mono font-bold text-slate-400 dark:text-zinc-500">
                    SLA not measured here
                  </span>
                </div>
                <div className="mt-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">{dept.name}</span>
                    {isInitiator && (
                      <span className="px-1 py-0.2 text-[9px] font-bold bg-rose-500 text-white rounded">
                        ALERT
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-medium text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                    {dept.twin}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Cross-Silo Scenario Switcher Bar */}
      <div className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400 dark:text-zinc-500">
                Interactive Cross-Department Scenario Simulations (MVP Live Action)
              </span>
              <span className="px-1.5 py-0.2 text-[9px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 rounded">
                5 Scenarios
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
              Select any multi-silo failure to simulate autonomous cross-agent interrogation, pre-flight verification, and live remediation.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleResetWorkflow}
              className="px-2.5 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-[#1a1a1a] dark:hover:bg-[#252525] text-slate-700 dark:text-zinc-300 border border-slate-200 dark:border-[#333] transition-colors flex items-center gap-1.5 cursor-pointer"
              title="Reset current scenario to initial alert state"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset State</span>
            </button>
            <button
              onClick={() => (simPlaying ? setSimPlaying(false) : handleStartSim())}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer ${
                simPlaying 
                  ? "bg-amber-600 text-white hover:bg-amber-700" 
                  : "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              }`}
            >
              {simPlaying ? (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Pause Walkthrough</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  <span>Play Dialogue Step-by-Step</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 5 Scenario Selector Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-[#1a1a1a]">
          <button
            onClick={() => handleTriggerScenario("windows-network-decomm")}
            disabled={triggeringScenario}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
              selectedWorkflowId === "csw-win-net-001"
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-slate-50 dark:bg-[#161616] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-[#2b2b2b] hover:border-blue-400"
            }`}
          >
            1. Windows AD ↔ Network Decomm/ACL
          </button>
          <button
            onClick={() => handleTriggerScenario("db-linux-network")}
            disabled={triggeringScenario}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
              selectedWorkflowId === "csw-db-linux-002"
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-slate-50 dark:bg-[#161616] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-[#2b2b2b] hover:border-blue-400"
            }`}
          >
            2. Database Pool ↔ Linux MTU & Kernel
          </button>
          <button
            onClick={() => handleTriggerScenario("middleware-windows-cloud")}
            disabled={triggeringScenario}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
              selectedWorkflowId === "csw-mid-win-003"
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-slate-50 dark:bg-[#161616] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-[#2b2b2b] hover:border-blue-400"
            }`}
          >
            3. Middleware TLS ↔ Windows PKI & Cloud
          </button>
          <button
            onClick={() => handleTriggerScenario("cloudops-database-failover")}
            disabled={triggeringScenario}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
              selectedWorkflowId === "csw-cloud-db-004"
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-slate-50 dark:bg-[#161616] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-[#2b2b2b] hover:border-blue-400"
            }`}
          >
            4. CloudOps Ingress ↔ DB Replica Desync
          </button>
          <button
            onClick={() => handleTriggerScenario("linux-network-storage")}
            disabled={triggeringScenario}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border cursor-pointer ${
              selectedWorkflowId === "csw-nre-linux-005"
                ? "bg-blue-600 text-white border-blue-600 shadow-sm"
                : "bg-slate-50 dark:bg-[#161616] text-slate-700 dark:text-zinc-300 border-slate-200 dark:border-[#2b2b2b] hover:border-blue-400"
            }`}
          >
            5. Linux NFS ↔ Switch Pause Frame Storm
          </button>
        </div>

        {/* Live Action Success Banner */}
        {actionSuccessBanner && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl flex items-center justify-between gap-3 text-xs text-emerald-800 dark:text-emerald-200"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="font-semibold">{actionSuccessBanner}</span>
            </div>
            <button
              onClick={() => setActionSuccessBanner(null)}
              className="text-emerald-700 dark:text-emerald-300 hover:underline font-bold text-[11px] cursor-pointer"
            >
              Dismiss
            </button>
          </motion.div>
        )}
      </div>

      {/* Main Workflow Details Container */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Incident Context, A2A Dialogue & Findings */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Active Incident Header Card */}
          <div className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 text-[10px] font-mono font-bold rounded bg-slate-100 dark:bg-[#1e1e1e] text-slate-600 dark:text-zinc-400">
                    {activeWorkflow?.id}
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-900">
                    Initiated by {activeWorkflow?.initiatingDepartment} Twin
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                    Status: {activeWorkflow?.status}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {activeWorkflow?.title}
                </h3>
              </div>
            </div>

            <div className="p-3.5 bg-slate-50 dark:bg-[#151515] border border-slate-200 dark:border-[#222] rounded-xl">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 mb-1">
                <Info className="w-3.5 h-3.5" />
                <span>Observed Incident Trigger / Alert Context</span>
              </div>
              <p className="text-xs text-slate-700 dark:text-zinc-300 leading-relaxed font-mono">
                {activeWorkflow?.incidentContext}
              </p>
            </div>
          </div>

          {/* Sub-tab Navigation: Dialogue Stream vs. Correlated Matrix vs. Custom Query */}
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-[#222] pb-2">
            <button
              onClick={() => setActiveTabSub("dialogue")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 ${
                activeTabSub === "dialogue"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#1a1a1a]"
              }`}
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
              <span>A2A Message Exchange ({activeWorkflow?.dialogue.length} Inquiries)</span>
            </button>
            <button
              onClick={() => setActiveTabSub("matrix")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 ${
                activeTabSub === "matrix"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#1a1a1a]"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Cross-Department Evidence Matrix</span>
            </button>
            <button
              onClick={() => setActiveTabSub("interactive-query")}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 ${
                activeTabSub === "interactive-query"
                  ? "bg-blue-600 text-white"
                  : "text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-[#1a1a1a]"
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Live A2A Query Terminal</span>
            </button>
          </div>

          {/* Tab 1: Live A2A Dialogue Stream */}
          {activeTabSub === "dialogue" && (
            <div className="space-y-4">
              {visibleDialogueCount < (activeWorkflow?.dialogue.length || 0) && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 rounded-xl flex items-center justify-between text-xs text-blue-900 dark:text-blue-200">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600 dark:text-blue-400" />
                    <span>
                      Simulating autonomous dialogue: step <strong>{visibleDialogueCount}</strong> of <strong>{activeWorkflow?.dialogue.length}</strong> inquiries streamed...
                    </span>
                  </div>
                  <button
                    onClick={handleShowAllDialogue}
                    className="font-bold text-blue-700 dark:text-blue-300 hover:underline cursor-pointer text-[11px]"
                  >
                    Skip to Complete Exchange
                  </button>
                </div>
              )}

              {activeWorkflow?.dialogue.slice(0, visibleDialogueCount).map((msg, index) => {
                const fromColor = getDepartmentColor(msg.fromDepartment);
                const toColor = getDepartmentColor(msg.toDepartment);
                return (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    key={msg.id}
                    className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-4 shadow-sm space-y-3"
                  >
                    {/* Header bar of message */}
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-md ${fromColor.badge}`}>
                          {msg.fromDepartment} Twin
                        </span>
                        <ChevronRight className="w-4 h-4 text-slate-400 dark:text-zinc-600" />
                        <span className={`px-2 py-0.5 text-xs font-bold rounded-md ${toColor.badge}`}>
                          {msg.toDepartment} Twin
                        </span>
                        <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-100 dark:bg-[#1a1a1a] text-slate-700 dark:text-zinc-300 rounded border border-slate-200 dark:border-[#333]">
                          {msg.queryType}
                        </span>
                      </div>

                      <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-zinc-500 font-mono">
                        <Clock className="w-3 h-3" />
                        <span>Latency: {msg.durationMs}ms</span>
                        <span>•</span>
                        <span>Confidence: {msg.confidenceScore}%</span>
                      </div>
                    </div>

                    {/* Query Subject */}
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-zinc-200">
                        "{msg.subject}"
                      </h4>
                    </div>

                    {/* Query & Response Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                      {/* Query Payload */}
                      <div className="p-3 bg-slate-50 dark:bg-[#151515] rounded-xl border border-slate-200 dark:border-[#222] font-mono">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 block mb-1">
                          DISPATCHED INQUIRY PAYLOAD
                        </span>
                        <pre className="text-[11px] text-slate-700 dark:text-zinc-300 whitespace-pre-wrap overflow-x-auto">
                          {JSON.stringify(msg.queryPayload, null, 2)}
                        </pre>
                      </div>

                      {/* Response Payload */}
                      <div className="p-3 bg-blue-50/50 dark:bg-blue-950/20 rounded-xl border border-blue-200/80 dark:border-blue-900/40 font-mono">
                        <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 block mb-1">
                          PEER AGENT TELEMETRY RESPONSE
                        </span>
                        <pre className="text-[11px] text-slate-800 dark:text-zinc-200 whitespace-pre-wrap overflow-x-auto">
                          {JSON.stringify(msg.responsePayload, null, 2)}
                        </pre>
                      </div>
                    </div>

                    {/* Finding Summary Banner */}
                    {msg.findingSummary && (
                      <div className="p-2.5 px-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        <div className="text-xs text-emerald-900 dark:text-emerald-200 font-medium">
                          <strong className="font-bold">A2A Peer Verdict:</strong> {msg.findingSummary}
                        </div>
                      </div>
                    )}
                  </motion.div>
                );
              })}
            </div>
          )}

          {/* Tab 2: Evidence Matrix */}
          {activeTabSub === "matrix" && (
            <div className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-5 shadow-sm space-y-4">
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Multi-Department Correlation & Impact Assessment
              </h4>
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                Top-layer orchestrator correlates evidence across silos to isolate the singular root cause, eliminating war-room finger pointing.
              </p>

              <div className="space-y-3">
                {activeWorkflow?.correlatedEvents.map((evt, idx) => {
                  const colors = getDepartmentColor(evt.department);
                  return (
                    <div 
                      key={idx}
                      className={`p-3.5 rounded-xl border flex items-start justify-between gap-4 ${colors.bg} ${colors.border}`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-xs font-bold rounded ${colors.badge}`}>
                            {evt.department} Team
                          </span>
                          <span className="text-xs font-mono font-bold text-slate-700 dark:text-zinc-300">
                            {evt.source}
                          </span>
                        </div>
                        <p className="text-xs text-slate-700 dark:text-zinc-300">
                          {evt.details}
                        </p>
                      </div>

                      <div className="shrink-0">
                        {evt.impact === "ROOT_CAUSE" && (
                          <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-rose-600 text-white shadow-sm flex items-center gap-1">
                            <AlertTriangle className="w-3.5 h-3.5" />
                            ROOT CAUSE
                          </span>
                        )}
                        {evt.impact === "SUSPECTED" && (
                          <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-amber-500 text-white shadow-sm">
                            SYMPTOMATIC
                          </span>
                        )}
                        {evt.impact === "NONE" && (
                          <span className="px-2.5 py-1 text-xs font-bold rounded-lg bg-emerald-600 text-white shadow-sm flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" />
                            VERIFIED HEALTHY
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Tab 3: Live Custom A2A Query Terminal */}
          {activeTabSub === "interactive-query" && (
            <div className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-5 shadow-sm space-y-4">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-blue-500" />
                  Live A2A Query Dispatcher (Interactive Test)
                </h4>
                <p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">
                  Instruct any Digital Twin to query another peer department agent in real-time. Verify maintenance windows, patch cycles, certificate revocations, or switch port decommissions.
                </p>
              </div>

              <form onSubmit={handleSendCustomQuery} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-zinc-500 mb-1 uppercase tracking-wider">
                      From (Initiating Agent)
                    </label>
                    <select
                      value={fromDept}
                      onChange={(e) => setFromDept(e.target.value as DepartmentType)}
                      className="w-full bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#333] rounded-lg p-2 text-xs font-medium text-slate-800 dark:text-zinc-200 focus:ring-1 focus:ring-blue-500"
                    >
                      {departments.map(d => (
                        <option key={d.name} value={d.name}>{d.name} Twin ({d.twin})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-zinc-500 mb-1 uppercase tracking-wider">
                      To (Target Department Agent)
                    </label>
                    <select
                      value={toDept}
                      onChange={(e) => setToDept(e.target.value as DepartmentType)}
                      className="w-full bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#333] rounded-lg p-2 text-xs font-medium text-slate-800 dark:text-zinc-200 focus:ring-1 focus:ring-blue-500"
                    >
                      {departments.map(d => (
                        <option key={d.name} value={d.name}>{d.name} Twin ({d.twin})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 dark:text-zinc-500 mb-1 uppercase tracking-wider">
                      Query Type
                    </label>
                    <select
                      value={queryType}
                      onChange={(e) => setQueryType(e.target.value as any)}
                      className="w-full bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#333] rounded-lg p-2 text-xs font-medium text-slate-800 dark:text-zinc-200 focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="MAINTENANCE_CHECK">MAINTENANCE_CHECK (Decomm/Chassis)</option>
                      <option value="PATCHING_STATUS">PATCHING_STATUS (OS/Firmware/WSUS)</option>
                      <option value="CERTIFICATE_AUDIT">CERTIFICATE_AUDIT (PKI/TLS/CRL)</option>
                      <option value="DNS_VALIDATION">DNS_VALIDATION (Infoblox/AD SRV)</option>
                      <option value="CONNECTIVITY_PROBE">CONNECTIVITY_PROBE (MTU/Socket/VLAN)</option>
                      <option value="DECOMMISSION_AUDIT">DECOMMISSION_AUDIT (Orphan Assets)</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 dark:text-zinc-500 mb-1 uppercase tracking-wider">
                    Query Subject & Scope
                  </label>
                  <input
                    type="text"
                    value={customSubject}
                    onChange={(e) => setCustomSubject(e.target.value)}
                    placeholder={`e.g. Check active maintenance or decomm on spine-switch-02 for port 88/389`}
                    className="w-full bg-slate-50 dark:bg-[#1a1a1a] border border-slate-200 dark:border-[#333] rounded-lg p-2 text-xs font-medium text-slate-800 dark:text-zinc-200 focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="flex justify-end">
                  <button
                    type="submit"
                    disabled={sendingQuery}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-sm transition-all flex items-center gap-2"
                  >
                    {sendingQuery ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Send className="w-3.5 h-3.5" />
                    )}
                    <span>Dispatch Autonomous A2A Query</span>
                  </button>
                </div>
              </form>

              {/* Live Responses */}
              {liveQueryResponses.length > 0 && (
                <div className="pt-4 border-t border-slate-100 dark:border-[#1a1a1a] space-y-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                    Live Dispatched A2A Query Results ({liveQueryResponses.length})
                  </span>
                  {liveQueryResponses.map((msg) => (
                    <div 
                      key={msg.id}
                      className="p-3 bg-slate-50 dark:bg-[#151515] border border-slate-200 dark:border-[#222] rounded-xl space-y-2 text-xs font-mono"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-blue-600 dark:text-blue-400">
                            [{msg.fromDepartment} $\rightarrow$ {msg.toDepartment}]
                          </span>
                          <span className="text-slate-700 dark:text-zinc-300 font-sans font-bold">
                            {msg.subject}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400">
                          {msg.durationMs}ms
                        </span>
                      </div>
                      <div className="p-2 bg-white dark:bg-black/40 rounded border border-slate-200 dark:border-[#222]">
                        <pre className="text-[11px] text-slate-800 dark:text-zinc-200 whitespace-pre-wrap">
                          {JSON.stringify(msg.responsePayload, null, 2)}
                        </pre>
                      </div>
                      <p className="text-xs font-sans text-emerald-600 dark:text-emerald-400 font-semibold">
                        Verdict: {msg.findingSummary}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>

        {/* Right 1 Col: Top-Layer RCA & L3/L4 HITL Safeguard */}
        <div className="space-y-6">
          
          {/* Top-Layer RCA Synthesis Card */}
          <div className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2 text-xs font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">
              <Sparkles className="w-4 h-4" />
              <span>Synthesized Root Cause Analysis</span>
            </div>

            <p className="text-xs text-slate-800 dark:text-zinc-200 leading-relaxed font-medium">
              {activeWorkflow?.concludedRCA}
            </p>

            <div className="p-3 bg-slate-50 dark:bg-[#151515] border border-slate-200 dark:border-[#222] rounded-xl space-y-2">
              <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider block">
                Recommended Remediation
              </span>
              <p className="text-xs text-slate-700 dark:text-zinc-300 font-mono">
                {activeWorkflow?.recommendedAction}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-[#1a1a1a] flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-400 dark:text-zinc-500 uppercase">
                Required HITL Sign-off
              </span>
              <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                {activeWorkflow?.requiredApprovalRole || "Network L3/L4"}
              </span>
            </div>
          </div>

          {/* Live Action & Safe Remediation Execution Console (MVP Feature) */}
          <div className="bg-gradient-to-br from-slate-900 to-slate-950 text-white rounded-2xl p-5 shadow-lg space-y-4 border border-slate-800">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-1.5 bg-blue-500/20 rounded-lg border border-blue-400/30">
                  <Terminal className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h4 className="text-xs font-bold tracking-wide uppercase">
                    {operatingMode === "SIMULATION" ? "Simulation Remediation Console" : "Live Action & Remediation Console"}
                  </h4>
                  <p className="text-[10px] text-zinc-400">
                    Pre-flight dry-run & live remediation dispatcher
                  </p>
                </div>
              </div>

              {activeWorkflow?.status === "REMEDIATED" ? (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-full flex items-center gap-1">
                  <CheckCheck className="w-3 h-3" />
                  Live Verified
                </span>
              ) : (
                <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-full flex items-center gap-1">
                  <Activity className="w-3 h-3" />
                  Ready to Execute
                </span>
              )}
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              {operatingMode === "SIMULATION"
                ? "Simulation mode is active. Apply validates the full approval and verification path without touching infrastructure."
                : "Live mode is active. Only an explicitly approved workflow can dispatch remediation to infrastructure."}
            </p>

            {/* Pre-Compiled Payload Display with Copy */}
            <div className="p-3 bg-black/60 rounded-xl border border-white/10 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                  <FileCode className="w-3 h-3 text-blue-400" />
                  Target Remediation Script
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(activeWorkflow?.recommendedAction || "");
                    setCopiedPayload(true);
                    setTimeout(() => setCopiedPayload(false), 2000);
                  }}
                  className="text-[10px] text-blue-400 hover:text-blue-300 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  {copiedPayload ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedPayload ? "Copied" : "Copy Payload"}</span>
                </button>
              </div>
              <div className="text-emerald-400 font-mono text-[11px] bg-black/40 p-2 rounded border border-white/5 overflow-x-auto">
                {activeWorkflow?.recommendedAction || "echo 'No action specified'"}
              </div>
            </div>

            {/* Action Buttons: Dry Run & Live Apply */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <button
                onClick={() => handleExecuteRemediation("dry-run")}
                disabled={remediationExecuting}
                className="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl border border-slate-700 transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                {remediationExecuting && remediationMode === "dry-run" ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
                ) : (
                  <CheckSquare className="w-3.5 h-3.5 text-blue-400" />
                )}
                <span>1. Pre-Flight Dry Run</span>
              </button>

              <button
                onClick={() => handleExecuteRemediation("live-apply")}
                disabled={remediationExecuting}
                className="py-2.5 px-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
              >
                {remediationExecuting && remediationMode === "live-apply" ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                <span>2. {operatingMode === "SIMULATION" ? "Apply in Simulation" : "Deploy Live Remediation"}</span>
              </button>
            </div>

            {/* Execution Logs Terminal */}
            {(remediationLogs.length > 0 || (activeWorkflow?.executionLogs && activeWorkflow.executionLogs.length > 0)) && (
              <div className="p-3 bg-black/80 rounded-xl border border-emerald-950/60 space-y-2">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400 border-b border-zinc-800 pb-1.5">
                  <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                    <Terminal className="w-3 h-3" />
                    <span>Real-Time Execution Logs</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        const logs = remediationLogs.length > 0 ? remediationLogs : (activeWorkflow?.executionLogs || []);
                        navigator.clipboard.writeText(logs.join("\n"));
                        setCopiedLogs(true);
                        setTimeout(() => setCopiedLogs(false), 2000);
                      }}
                      className="text-zinc-400 hover:text-white cursor-pointer"
                    >
                      {copiedLogs ? "Copied" : "Copy"}
                    </button>
                    <button
                      onClick={() => setRemediationLogs([])}
                      className="text-zinc-400 hover:text-white cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="font-mono text-[10px] space-y-1 max-h-48 overflow-y-auto pr-1">
                  {(remediationLogs.length > 0 ? remediationLogs : (activeWorkflow?.executionLogs || [])).map((log, lidx) => (
                    <div 
                      key={lidx} 
                      className={`leading-relaxed ${
                        log.includes("VERIFIED") || log.includes("SUCCESS") || log.includes("Active")
                          ? "text-emerald-400 font-semibold"
                          : log.includes("ROLLBACK") || log.includes("Dry Run")
                          ? "text-sky-300"
                          : "text-zinc-300"
                      }`}
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Approval Gate Shortcut */}
            {activeWorkflow?.requiredApprovalRole && (
              <div className="pt-2 border-t border-white/10 flex items-center justify-between">
                <span className="text-[10px] text-zinc-400">
                  Governance gate for {activeWorkflow.requiredApprovalRole}:
                </span>
                <button
                  onClick={() => setActiveTab("approvals")}
                  className="text-[11px] font-bold text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <span>HITL Gatekeeper</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>

          {/* Quick ROI Anchor to Delivery Manager */}
          <div className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-4 shadow-sm space-y-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500 block">
              Team Enablement Impact
            </span>
            <p className="text-xs text-slate-700 dark:text-zinc-300">
              Cross-department triage time reduced from <span className="line-through text-rose-500">48 minutes</span> to <strong>45 seconds</strong>.
            </p>
            <button
              onClick={() => setActiveTab("enablement")}
              className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 pt-1"
            >
              <span>View Full Team Enablement & ROI Framework</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

        </div>

      </div>

    </div>
  );
}
