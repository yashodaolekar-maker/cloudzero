import React, { useState } from "react";
import { TeamEnablementMetric, SSOUser } from "../types";
import { 
  TrendingUp, 
  Users, 
  ShieldCheck, 
  Zap, 
  Clock, 
  ArrowRight, 
  CheckCircle2, 
  Sparkles, 
  FileText, 
  ChevronRight, 
  Layers, 
  Network, 
  Server, 
  AlertCircle,
  Copy,
  Check
} from "lucide-react";
import { motion } from "motion/react";

interface TeamEnablementViewProps {
  currentUser: SSOUser;
  metrics: TeamEnablementMetric[];
  setActiveTab: (tab: string) => void;
}

export default function TeamEnablementView({
  currentUser,
  metrics,
  setActiveTab
}: TeamEnablementViewProps) {
  const [copiedDeck, setCopiedDeck] = useState(false);
  const [activePillar, setActivePillar] = useState<number>(0);

  const pillars = [
    {
      title: "1. Shift-Left for L1/L2 Support Staff",
      subtitle: "Empowering frontline engineers with cross-domain diagnostic super-powers",
      icon: Zap,
      color: "text-amber-500 bg-amber-500/10 border-amber-500/20",
      problem: "Traditional frontline staff lack credentials, specialized CLI knowledge, or permissions to inspect Arista switch BGP routes, Windows Kerberos KDC logs, or Linux kernel somaxconn backlogs. Result: Every cross-domain symptom is escalated to tier 3/4.",
      solution: "Digital Twin autonomous query bus executes pre-authorized read-only telemetry audits across all 6 departments with one click. L1/L2 staff receive clear, synthesized plain-English findings.",
      keyOutcome: "74.2% of cross-silo incidents diagnosed and triaged by L1/L2 before paging on-call SMEs."
    },
    {
      title: "2. Eliminating War-Room Ping-Pong",
      subtitle: "Ending multi-team bridge arguments with authoritative inter-agent proof",
      icon: Users,
      color: "text-blue-500 bg-blue-500/10 border-blue-500/20",
      problem: "During P1 bridge calls, 40+ minutes are wasted in finger-pointing: Windows team suspects network firewall, Network team suspects cloud gateway, Database team suspects Linux OS kernel.",
      solution: "All 6 digital twins cross-interrogate simultaneously in sub-second intervals: Windows twin queries Network twin on active decomm/ACLs; Network twin queries CloudOps on ExpressRoute. Correlated evidence isolates root cause immediately.",
      keyOutcome: "War-room triage time collapsed from 48 minutes down to 45 seconds."
    },
    {
      title: "3. Safeguarding Network L3/L4 Engineers",
      subtitle: "Protecting senior architects through Human-in-the-Loop (HITL) precision gates",
      icon: ShieldCheck,
      color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20",
      problem: "Senior Network L3/L4 engineers are inundated with repetitive pings during maintenance windows and false-positive connectivity escalations, burning out critical architectural talent.",
      solution: "Autonomous agents handle all discovery and correlation. Dangerous changes (switch ACL rollback, BGP path prepend, route re-advertisement) require verified Network L3/L4 HITL approval with pre-calculated blast radius.",
      keyOutcome: "Unnecessary L3/L4 pager interruptions reduced by 89.4% (from 38.6 to 4.1/week)."
    },
    {
      title: "4. Living Tribal Knowledge & Auto-Codified Runbooks",
      subtitle: "Preserving cross-departmental operations and decommission dependencies",
      icon: Layers,
      color: "text-purple-500 bg-purple-500/10 border-purple-500/20",
      problem: "Complex dependencies (e.g. legacy IIS server hosting AD CS CRL distribution point, or switch port trunking for domain controllers) live only in senior engineers' heads and are lost during turnover.",
      solution: "Digital twin agents maintain active memory of hardware lifecycle decommissions, certificate dependencies, and switch configurations, alerting peer twins before outages occur.",
      keyOutcome: "Automated runbook coverage increased from 31% to 91.8%; maintenance conflicts down 98%."
    }
  ];

  const handleCopyDeckSummary = () => {
    const summary = `
CLOUD ZERO - FEDERATED DIGITAL TWIN ORCHESTRATOR
EXECUTIVE BRIEFING: TEAM ENABLEMENT & ROI FOR DELIVERY MANAGEMENT & OPERATIONS

1. CORE VALUE PROPOSITION:
Unifies Windows, Linux, Database, Network, Middleware, and CloudOps teams into an autonomous Agent-to-Agent (A2A) mesh. Resolves cross-silo incidents in seconds rather than hours of war-room debate.

2. TEAM ENABLEMENT IMPACTS:
- Shift-Left for L1/L2: 74.2% self-resolution rate without paging L3/L4.
- War-Room Triage: Reduced from 48 minutes to 45 seconds.
- Senior L3/L4 Protection: Unnecessary pager calls reduced by 89.4% with HITL safety gates.
- MTTR Acceleration: Complex cross-silo resolution reduced from 64 minutes to 8.4 minutes.
- Maintenance Conflicts: Undetected maintenance errors reduced to 0.8% (from 41.5%).

3. NETWORK L3/L4 GOVERNANCE:
Autonomous agents never perform destructive network changes without explicit Human-in-the-Loop authorization by certified Network L3/L4 engineers.
    `.trim();

    navigator.clipboard.writeText(summary);
    setCopiedDeck(true);
    setTimeout(() => setCopiedDeck(false), 3000);
  };

  return (
    <div id="team-enablement-view" className="h-full overflow-y-auto p-6 space-y-6">
      
      {/* Executive Header Banner */}
      <div className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-purple-600/10 dark:bg-purple-500/20 text-purple-600 dark:text-purple-400 rounded-xl">
                <TrendingUp className="w-5 h-5" />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                Team Enablement & ROI Framework
              </h2>
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                Delivery Manager & Operations Briefing
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-zinc-400 max-w-3xl leading-relaxed">
              Addressing Delivery Management & Leadership: How the Top-Layer Digital Twin architecture breaks down operational silos across <strong className="text-slate-800 dark:text-zinc-200">Windows, Linux, Database, Network, Middleware, and CloudOps</strong>, empowers L1/L2 frontline triage, and shields senior L3/L4 specialists.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleCopyDeckSummary}
              className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-[#1a1a1a] dark:hover:bg-[#252525] text-slate-700 dark:text-zinc-200 text-xs font-bold rounded-xl border border-slate-200 dark:border-[#333] transition-all flex items-center gap-2"
            >
              {copiedDeck ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedDeck ? "Summary Copied!" : "Copy Executive Briefing"}</span>
            </button>
            <button
              onClick={() => setActiveTab("cross-silo")}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all flex items-center gap-2"
            >
              <span>View Live A2A Mesh</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 6 Key ROI Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {metrics.map((m, idx) => (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.05 }}
            key={idx}
            className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-5 shadow-sm space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
                {m.pillar}
              </span>
              <span className="px-2 py-0.5 text-xs font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                {m.improvement}
              </span>
            </div>

            <div className="space-y-1">
              <div className="text-2xl font-black tracking-tight text-slate-900 dark:text-white">
                {m.value}
              </div>
              <div className="text-xs font-semibold text-slate-500 dark:text-zinc-400 flex items-center gap-2">
                <span>Baseline: <span className="line-through">{m.baseline}</span></span>
                <span>•</span>
                <span className="text-slate-700 dark:text-zinc-300 font-medium">{m.metric}</span>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-zinc-400 leading-relaxed pt-2 border-t border-slate-100 dark:border-[#1a1a1a]">
              {m.description}
            </p>
          </motion.div>
        ))}
      </div>

      {/* The 4 Strategic Enablement Pillars - Deep Dive */}
      <div className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-6 shadow-sm space-y-6">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            The 4 Enablement Pillars of Federated Digital Twins
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Click each pillar to see how it resolves daily cross-department friction across Windows, Linux, Database, Network, Middleware, and CloudOps teams.
          </p>
        </div>

        {/* Pillar Selection Tabs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {pillars.map((p, idx) => {
            const Icon = p.icon;
            const isSelected = activePillar === idx;
            return (
              <button
                key={idx}
                onClick={() => setActivePillar(idx)}
                className={`p-3.5 text-left rounded-xl border transition-all ${
                  isSelected 
                    ? "bg-blue-50 dark:bg-blue-950/40 border-blue-500 ring-2 ring-blue-500/20" 
                    : "bg-slate-50 dark:bg-[#141414] border-slate-200 dark:border-[#252525] hover:border-slate-300 dark:hover:border-[#333]"
                }`}
              >
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center mb-2 border ${p.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="text-xs font-bold text-slate-900 dark:text-white line-clamp-1">
                  {p.title}
                </div>
                <p className="text-[10px] text-slate-500 dark:text-zinc-400 line-clamp-1 mt-0.5">
                  {p.subtitle}
                </p>
              </button>
            );
          })}
        </div>

        {/* Active Pillar Showcase */}
        {pillars[activePillar] && (
          <div className="p-5 bg-slate-50 dark:bg-[#141414] border border-slate-200 dark:border-[#252525] rounded-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl border ${pillars[activePillar].color}`}>
                {React.createElement(pillars[activePillar].icon, { className: "w-5 h-5" })}
              </div>
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                  {pillars[activePillar].title}
                </h4>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  {pillars[activePillar].subtitle}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="p-4 bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/40 rounded-xl space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-400 block">
                  The Friction (Without Digital Twins)
                </span>
                <p className="text-xs text-slate-700 dark:text-zinc-300 leading-relaxed">
                  {pillars[activePillar].problem}
                </p>
              </div>

              <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/40 rounded-xl space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400 block">
                  The Enablement (With Cloud Zero A2A Mesh)
                </span>
                <p className="text-xs text-slate-700 dark:text-zinc-300 leading-relaxed">
                  {pillars[activePillar].solution}
                </p>
              </div>
            </div>

            <div className="p-3 bg-white dark:bg-black/40 border border-slate-200 dark:border-white/10 rounded-xl flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-zinc-300">
                Quantified Operational Outcome:
              </span>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">
                {pillars[activePillar].keyOutcome}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Before vs. After Workflow Comparison Matrix */}
      <div className="bg-white dark:bg-[#0f0f0f] border border-slate-200 dark:border-[#222] rounded-2xl p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            Workflow Comparison: Traditional War-Room vs. Cloud Zero Top-Layer A2A
          </h3>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            Demonstrating to leadership how cross-department incident handling changes during a live P1 event.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-[#222] text-slate-400 dark:text-zinc-500 font-bold uppercase tracking-wider text-[10px]">
                <th className="py-3 px-4">Dimension</th>
                <th className="py-3 px-4 text-rose-600 dark:text-rose-400">Traditional Siloed Teams</th>
                <th className="py-3 px-4 text-emerald-600 dark:text-emerald-400">Cloud Zero Federated Twins</th>
                <th className="py-3 px-4">Efficiency Gain</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-[#1a1a1a]">
              <tr>
                <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                  Cross-Domain Evidence Gathering
                </td>
                <td className="py-3.5 px-4 text-slate-600 dark:text-zinc-400">
                  Manual SSH/RDP logins, tickets opened between teams, 30-50 min delay.
                </td>
                <td className="py-3.5 px-4 text-emerald-700 dark:text-emerald-300 font-medium">
                  Autonomous A2A protocol queries across all 6 twin nodes simultaneously (120ms).
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">
                  98.4% faster
                </td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                  Maintenance & Decomm Correlation
                </td>
                <td className="py-3.5 px-4 text-slate-600 dark:text-zinc-400">
                  Uncoordinated; teams unaware of peer switch decomm or ACL changes until failure.
                </td>
                <td className="py-3.5 px-4 text-emerald-700 dark:text-emerald-300 font-medium">
                  Real-time cross-correlation with ServiceNow CMDB change records and ACL rules.
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">
                  Instant Match
                </td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                  Network L3/L4 Expert Workload
                </td>
                <td className="py-3.5 px-4 text-slate-600 dark:text-zinc-400">
                  Senior engineers paged repeatedly to prove "the network is not down".
                </td>
                <td className="py-3.5 px-4 text-emerald-700 dark:text-emerald-300 font-medium">
                  Protected by HITL gate; only contacted to review verified rollback actions.
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">
                  -89.4% paging
                </td>
              </tr>
              <tr>
                <td className="py-3.5 px-4 font-bold text-slate-900 dark:text-white">
                  Mean Time to Resolution (MTTR)
                </td>
                <td className="py-3.5 px-4 text-slate-600 dark:text-zinc-400">
                  64.0 minutes average across cross-silo incidents.
                </td>
                <td className="py-3.5 px-4 text-emerald-700 dark:text-emerald-300 font-medium">
                  8.4 minutes average with pre-compiled rollback scripts.
                </td>
                <td className="py-3.5 px-4 font-bold text-emerald-600">
                  -86.9% MTTR
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
