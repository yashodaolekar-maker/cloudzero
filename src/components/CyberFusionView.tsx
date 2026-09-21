import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  Ban,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileClock,
  Fingerprint,
  Info,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  ShieldAlert,
  ShieldEllipsis,
  TriangleAlert,
  WifiOff,
} from "lucide-react";
import type {
  CyberCorrelationCase,
  CyberEvidence,
  CyberFusionAnalysis,
  CyberFusionReplayComparison,
  CyberHypothesis,
  CyberShadowProposal,
  DepartmentType,
  OperatingMode,
  TelemetryAnomalySeverity,
  TelemetryConnectorSource,
  TelemetryFreshness,
} from "../types";

interface CyberFusionStatePayload {
  success: boolean;
  fusionMode: "SHADOW";
  telemetryMode: OperatingMode;
  remediationMode: OperatingMode;
  analysis: CyberFusionAnalysis | null;
  analyses: Array<{
    analysisId: string;
    snapshotCutoff: string;
    caseCount: number;
    integrityHash: string;
  }>;
  latestReplay: CyberFusionReplayComparison | null;
}

interface CyberFusionViewProps {
  setActiveTab: (tabId: string) => void;
}

const connectorLabels: Record<TelemetryConnectorSource, string> = {
  SOLARWINDS: "SolarWinds",
  SPLUNK: "Splunk",
  DATADOG: "Datadog",
  GOOGLE_CLOUD_MONITORING: "Google Cloud Monitoring",
};

const severityWeight: Record<TelemetryAnomalySeverity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const severityTone: Record<TelemetryAnomalySeverity, string> = {
  INFO: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  LOW: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  MEDIUM: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  HIGH: "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300",
  CRITICAL: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
};

const freshnessTone: Record<TelemetryFreshness, string> = {
  FRESH: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  STALE: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  UNKNOWN: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

const departments: DepartmentType[] = ["Windows", "Linux", "Database", "Network", "Middleware", "CloudOps"];

function formatAge(timestamp?: string) {
  if (!timestamp) return "age unavailable";
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "age unknown";
  const seconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatTimestamp(timestamp?: string) {
  if (!timestamp) return "Unavailable";
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return "Invalid timestamp";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(parsed);
}

function shortHash(hash?: string) {
  if (!hash) return "not recorded";
  return hash.length > 22 ? `${hash.slice(0, 11)}…${hash.slice(-8)}` : hash;
}

function highestSeverity(evidence: CyberEvidence[]): TelemetryAnomalySeverity | null {
  if (evidence.length === 0) return null;
  return evidence.reduce<TelemetryAnomalySeverity>((highest, item) =>
    severityWeight[item.severity] > severityWeight[highest] ? item.severity : highest,
  evidence[0].severity);
}

function scorePercent(score: number) {
  return Math.max(0, Math.min(100, score <= 1 ? score * 100 : score));
}

function scoreTier(score: number) {
  const percent = scorePercent(score);
  if (percent >= 70) return "Elevated correlation";
  if (percent >= 40) return "Guarded correlation";
  return "Limited correlation";
}

function evidenceKindLabel(kind: CyberEvidence["kind"]) {
  return kind.toLowerCase().split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

function hypothesisTypeLabel(type: CyberHypothesis["type"]) {
  return type.toLowerCase().split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
}

function ModeBadge({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "shadow" | "live" | "neutral" | "warning" }) {
  const colors = tone === "shadow" || tone === "warning"
    ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
    : tone === "live"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"
      : "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300";
  return <span className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-[10px] font-semibold ${colors}`}><span className={`h-1.5 w-1.5 rounded-full ${tone === "live" ? "bg-emerald-500" : tone === "shadow" || tone === "warning" ? "bg-amber-500" : "bg-slate-400"}`} aria-hidden="true" />{label}: {value}</span>;
}

function DisclosureChevron() {
  return <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />;
}

function HypothesisDetail({ hypothesis, primary }: { key?: string; hypothesis: CyberHypothesis; primary: boolean }) {
  const breakdown = [
    ["Base", hypothesis.scoreBreakdown.base],
    ["Temporal alignment", hypothesis.scoreBreakdown.temporalAlignment],
    ["Independent sources", hypothesis.scoreBreakdown.independentSources],
    ["Severity", hypothesis.scoreBreakdown.severity],
    ["Signal confidence", hypothesis.scoreBreakdown.signalConfidence],
    ["CI resolution", hypothesis.scoreBreakdown.ciResolution],
    ["Data freshness", hypothesis.scoreBreakdown.dataFreshness],
    ["Live origin", hypothesis.scoreBreakdown.liveOrigin],
    ["Evidence diversity", hypothesis.scoreBreakdown.evidenceDiversity],
    ["Contradiction", hypothesis.scoreBreakdown.contradictionPenalty],
  ].filter(([, value]) => value !== 0);
  const percent = scorePercent(hypothesis.confidenceScore);

  return (
    <article className={`rounded-md border p-4 ${primary ? "border-violet-300 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-950/20" : "border-slate-200 dark:border-slate-800"}`}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-[10px] text-slate-500">#{hypothesis.rank}</span>{primary && <span className="rounded bg-violet-700 px-2 py-1 text-[10px] font-semibold text-white">Leading</span>}<span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">UNCONFIRMED</span><span className="text-[10px] text-slate-500">{hypothesisTypeLabel(hypothesis.type)}</span></div><h3 className="mt-2 text-sm font-bold">{hypothesis.title}</h3><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">{hypothesis.explanation}</p></div>
        <div className="shrink-0 sm:text-right"><p className="font-mono text-2xl font-bold text-violet-700 dark:text-violet-300">{Math.round(percent)}<span className="text-[10px] text-slate-500">/100</span></p><p className="text-[10px] text-slate-500">{scoreTier(hypothesis.confidenceScore)}</p></div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800" aria-label={`Deterministic correlation score ${Math.round(percent)} out of 100`}><div className="h-full bg-violet-600" style={{ width: `${percent}%` }} /></div>
      <dl className="mt-4 grid gap-x-5 gap-y-2 text-[10px] sm:grid-cols-2 lg:grid-cols-3">{breakdown.map(([label, value]) => <div key={String(label)} className="flex items-center justify-between gap-2 border-b border-slate-100 pb-1 dark:border-slate-800"><dt className="text-slate-500">{label}</dt><dd className={`font-mono font-semibold ${Number(value) < 0 ? "text-rose-700 dark:text-rose-300" : "text-slate-900 dark:text-white"}`}>{Number(value) > 0 ? "+" : ""}{value}</dd></div>)}</dl>
      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-500"><span>{hypothesis.supportingEvidenceIds.length} supporting</span><span>{hypothesis.contradictingEvidenceIds.length} contradicting</span><span>Disposition: {hypothesis.disposition}</span>{hypothesis.scoreBreakdown.appliedCap !== undefined && <span className="text-amber-700 dark:text-amber-300">Score capped at {Math.round(scorePercent(hypothesis.scoreBreakdown.appliedCap))}/100</span>}</div>
      {hypothesis.attackTechniqueIds.length > 0 && <p className="mt-3 text-[10px] text-slate-500">ATT&amp;CK mapping: <span className="font-mono">{hypothesis.attackTechniqueIds.join(" · ")}</span></p>}
    </article>
  );
}

function EvidenceDetail({ evidence, topHypothesis }: { evidence: CyberEvidence[]; topHypothesis?: CyberHypothesis }) {
  if (evidence.length === 0) return <div className="flex items-start gap-3 rounded border border-dashed border-slate-300 p-4 dark:border-slate-700"><WifiOff className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" /><div><h3 className="text-xs font-semibold">No persisted evidence</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">A causal path cannot be constructed without connector evidence.</p></div></div>;

  return <div className="divide-y divide-slate-100 dark:divide-slate-800">{[...evidence].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt)).map((item, index) => {
    const supports = topHypothesis?.supportingEvidenceIds.includes(item.id) || false;
    const contradicts = topHypothesis?.contradictingEvidenceIds.includes(item.id) || false;
    return <article key={item.id} className="py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-[10px] font-semibold text-violet-700 dark:text-violet-300">Signal {index + 1} · {evidenceKindLabel(item.kind)}</p><h3 className="mt-1 text-xs font-bold leading-5">{item.summary}</h3></div><div className="flex shrink-0 flex-wrap gap-1.5"><span className={`rounded border px-2 py-1 text-[10px] font-semibold ${severityTone[item.severity]}`}>{item.severity}</span><span className={`rounded border px-2 py-1 text-[10px] font-semibold ${freshnessTone[item.freshness]}`}>{item.freshness}</span><span className={`rounded border px-2 py-1 text-[10px] font-semibold ${item.dataOrigin === "LIVE" ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"}`}>{item.dataOrigin}</span></div></div>
      <dl className="mt-3 grid gap-x-5 gap-y-2 text-[10px] sm:grid-cols-2 lg:grid-cols-3"><div><dt className="text-slate-500">Relationship</dt><dd className="mt-0.5 font-semibold">{contradicts ? "Contradicts leading assessment" : supports ? "Supports leading assessment" : "Context only"}</dd></div><div><dt className="text-slate-500">Source</dt><dd className="mt-0.5 font-semibold">{connectorLabels[item.source]} · {item.sourceFamily}</dd></div><div><dt className="text-slate-500">Observed</dt><dd className="mt-0.5" title={formatTimestamp(item.observedAt)}>{formatAge(item.observedAt)}{item.observedAtAssumed ? " · assumed timestamp" : ""}</dd></div><div><dt className="text-slate-500">Canonical CI</dt><dd className="mt-0.5 break-all font-mono">{item.canonicalCiId}</dd></div><div><dt className="text-slate-500">Signal type</dt><dd className="mt-0.5 break-all font-mono">{item.signalType}</dd></div><div><dt className="text-slate-500">Integrity</dt><dd className="mt-0.5 break-all font-mono" title={item.integrityHash}>{shortHash(item.integrityHash)} · {item.duplicateCount} duplicate{item.duplicateCount === 1 ? "" : "s"}</dd></div></dl>
      {(item.attackTechniqueIds.length > 0 || item.cveIds.length > 0 || item.sourceRecordHashes.length > 0) && <p className="mt-3 break-words font-mono text-[10px] leading-4 text-slate-500">ATT&amp;CK {item.attackTechniqueIds.join(", ") || "none"} · CVEs {item.cveIds.join(", ") || "none"} · source records {item.sourceRecordHashes.map(shortHash).join(", ") || "none"}</p>}
    </article>;
  })}</div>;
}

function ProposalDetail({ proposal, canonicalCiId }: { key?: string; proposal: CyberShadowProposal; canonicalCiId: string }) {
  return <article className="rounded-md border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">{proposal.kind.replaceAll("_", " ")} · SHADOW ONLY</p><h3 className="mt-1 text-xs font-bold">{proposal.title}</h3></div><span className="flex w-fit items-center gap-1 rounded border border-amber-300 bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"><Ban className="h-3 w-3" />Not executable</span></div><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">{proposal.description}</p><dl className="mt-3 grid gap-x-5 gap-y-2 text-[10px] sm:grid-cols-2"><div><dt className="text-slate-500">Target</dt><dd className="mt-0.5 break-all font-mono">{proposal.target || canonicalCiId}</dd></div><div><dt className="text-slate-500">Risk</dt><dd className="mt-0.5 font-semibold">{proposal.risk}</dd></div><div><dt className="text-slate-500">Rationale</dt><dd className="mt-0.5">{proposal.rationale}</dd></div><div><dt className="text-slate-500">Rollback outline</dt><dd className="mt-0.5">{proposal.rollbackSummary}</dd></div></dl><p className="mt-3 text-[10px] leading-4 text-slate-500">Verification outline: {proposal.verificationSteps.join(" ") || "Not supplied; proposal remains blocked."}</p></article>;
}

function LoadingState() {
  return <div className="mx-auto max-w-[1500px] animate-pulse p-4 pt-20 sm:p-6 md:pt-6 xl:p-8" aria-label="Loading Cyber Fusion analysis"><div className="h-3 w-36 rounded bg-slate-200 dark:bg-slate-800" /><div className="mt-3 h-8 w-64 rounded bg-slate-200 dark:bg-slate-800" /><div className="mt-6 h-24 rounded-lg bg-white dark:bg-slate-900" /><div className="mt-5 grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-64 rounded-lg bg-white dark:bg-slate-900" />)}</div></div>;
}

export default function CyberFusionView({ setActiveTab }: CyberFusionViewProps) {
  const [state, setState] = useState<CyberFusionStatePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [replayTargetId, setReplayTargetId] = useState("");

  const loadState = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    try {
      const response = await fetch("/api/cyber-fusion/state", { headers: { Accept: "application/json" }, cache: "no-store" });
      const payload = await response.json() as CyberFusionStatePayload & { error?: string };
      if (!response.ok || !payload.success) throw new Error(payload.error || `Cyber Fusion state returned HTTP ${response.status}.`);
      setState(payload);
      setError(null);
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "Cyber Fusion state is unavailable.");
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState(true);
    const interval = window.setInterval(() => void loadState(false), 30000);
    return () => window.clearInterval(interval);
  }, [loadState]);

  useEffect(() => {
    const cases = state?.analysis?.cases || [];
    if (!selectedCaseId || !cases.some((item) => item.id === selectedCaseId)) setSelectedCaseId(cases[0]?.id || "");
    const analyses = state?.analyses || [];
    if (!replayTargetId || !analyses.some((item) => item.analysisId === replayTargetId)) setReplayTargetId(state?.analysis?.analysisId || analyses[0]?.analysisId || "");
  }, [state, selectedCaseId, replayTargetId]);

  const analyze = async () => {
    setAnalyzing(true);
    setActionMessage(null);
    try {
      const response = await fetch("/api/cyber-fusion/analyze", { method: "POST", headers: { Accept: "application/json" } });
      const payload = await response.json() as CyberFusionStatePayload & { error?: string };
      if (!response.ok || !payload.success) throw new Error(payload.error || `Analysis returned HTTP ${response.status}.`);
      setState(payload);
      setError(null);
      setActionMessage("Shadow analysis refreshed from persisted telemetry. No production action was taken.");
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "Shadow analysis failed.");
    } finally {
      setAnalyzing(false);
    }
  };

  const replay = async () => {
    if (!replayTargetId) return;
    setReplaying(true);
    setActionMessage(null);
    try {
      const response = await fetch(`/api/cyber-fusion/analyses/${encodeURIComponent(replayTargetId)}/replay`, { method: "POST", headers: { Accept: "application/json" } });
      const payload = await response.json() as { success: boolean; comparison: CyberFusionReplayComparison; analysis: CyberFusionAnalysis; error?: string };
      if (!response.ok || !payload.success) throw new Error(payload.error || `Replay returned HTTP ${response.status}.`);
      setState((previous) => previous ? { ...previous, latestReplay: payload.comparison } : previous);
      setError(null);
      setActionMessage("Deterministic replay completed against the same persisted inputs. Live telemetry was not recollected.");
    } catch (failure: unknown) {
      setError(failure instanceof Error ? failure.message : "Deterministic replay failed.");
    } finally {
      setReplaying(false);
    }
  };

  const analysis = state?.analysis || null;
  const currentCase = useMemo(() => analysis?.cases.find((item) => item.id === selectedCaseId) || analysis?.cases[0] || null, [analysis, selectedCaseId]);
  const topHypothesis = currentCase?.hypotheses.find((item) => item.id === currentCase.topHypothesisId) || currentCase?.hypotheses[0];
  const severity = currentCase ? highestSeverity(currentCase.evidence) : null;
  const evidenceFreshness: TelemetryFreshness = !currentCase || currentCase.evidence.length === 0
    ? "UNKNOWN"
    : currentCase.evidence.some((item) => item.stale || item.freshness === "STALE")
      ? "STALE"
      : currentCase.evidence.every((item) => item.freshness === "FRESH") ? "FRESH" : "UNKNOWN";
  const caseSources = currentCase ? new Set(currentCase.evidence.map((item) => item.source)).size : 0;
  const safeProposal = currentCase?.shadowProposals[0];
  const missingCoverage = analysis ? new Set([...analysis.coverage.missingConnectors, ...analysis.coverage.unavailableConnectors]).size : 0;
  const coveragePercent = analysis ? Math.round(Math.max(0, Math.min(100, analysis.coverage.ratio > 1 ? analysis.coverage.ratio : analysis.coverage.ratio * 100))) : null;
  const recentAnalyses = useMemo(() => {
    const entries = [...(state?.analyses || [])].sort((a, b) => Date.parse(b.snapshotCutoff) - Date.parse(a.snapshotCutoff));
    if (analysis && !entries.some((entry) => entry.analysisId === analysis.analysisId)) entries.unshift({ analysisId: analysis.analysisId, snapshotCutoff: analysis.snapshotCutoff, caseCount: analysis.cases.length, integrityHash: analysis.integrityHash });
    const current = analysis ? entries.find((entry) => entry.analysisId === analysis.analysisId) : undefined;
    return [current, ...entries.filter((entry) => entry.analysisId !== current?.analysisId)].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)).slice(0, 10);
  }, [analysis, state?.analyses]);

  if (loading && !state) return <main className="h-screen min-w-0 flex-1 overflow-y-auto bg-slate-100 text-slate-900 dark:bg-[#070b14] dark:text-slate-100"><LoadingState /></main>;

  if (!state && error) return <main className="grid h-screen min-w-0 flex-1 place-items-center overflow-y-auto bg-slate-100 p-6 pt-20 text-slate-900 dark:bg-[#070b14] dark:text-slate-100 md:pt-6"><section className="w-full max-w-lg rounded-lg border border-rose-200 bg-white p-7 text-center shadow-sm dark:border-rose-900 dark:bg-slate-900" role="alert"><span className="mx-auto grid h-12 w-12 place-items-center rounded-md border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"><ShieldAlert className="h-6 w-6" /></span><h1 className="mt-4 text-lg font-bold">Cyber Fusion unavailable</h1><p className="mt-2 text-xs leading-5 text-slate-500">{error} No security or coverage conclusion can be inferred while this endpoint is unavailable.</p><button type="button" onClick={() => void loadState(true)} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><RefreshCw className="h-4 w-4" />Retry</button></section></main>;

  return (
    <main className="h-screen min-w-0 flex-1 overflow-y-auto bg-slate-100 pt-16 text-slate-900 dark:bg-[#070b14] dark:text-slate-100 md:pt-0">
      <div className="mx-auto max-w-[1500px] p-4 sm:p-6 xl:p-8">
        <header className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl"><p className="flex items-center gap-2 text-[10px] font-semibold text-violet-700 dark:text-violet-300"><ShieldEllipsis className="h-4 w-4" /> Evidence correlation</p><h1 className="mt-1 text-2xl font-bold tracking-tight">Cyber Fusion</h1><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">Review explainable correlations across shared CIs. Every assessment remains unconfirmed and this workspace has no execution control.</p></div>
            <button type="button" onClick={analyze} disabled={analyzing} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-violet-700 px-4 text-xs font-semibold text-white hover:bg-violet-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-wait disabled:opacity-60"><SearchCheck className={`h-4 w-4 ${analyzing ? "animate-pulse" : ""}`} />{analyzing ? "Analyzing evidence" : "Refresh shadow analysis"}</button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2"><ModeBadge label="Fusion" value={state?.fusionMode || "SHADOW"} tone="shadow" /><ModeBadge label="Telemetry" value={state?.telemetryMode || "UNKNOWN"} tone={state?.telemetryMode === "LIVE" ? "live" : "warning"} /><ModeBadge label="Remediation environment" value={state?.remediationMode || "UNKNOWN"} tone={state?.remediationMode === "LIVE" ? "live" : "warning"} /><ModeBadge label="Evidence freshness" value={evidenceFreshness} tone={evidenceFreshness === "FRESH" ? "live" : evidenceFreshness === "STALE" ? "warning" : "neutral"} /><ModeBadge label="Causal status" value="UNCONFIRMED" tone="warning" /></div>
        </header>

        {error && <div role="status" className="mt-3 flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>Latest refresh failed. The last loaded analysis remains visible and continues to age. {error}</span></div>}
        {actionMessage && <div role="status" className="mt-3 flex items-start gap-2 rounded border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{actionMessage}</div>}

        {!analysis && <section className="mt-5 rounded-lg border border-dashed border-slate-300 bg-white px-6 py-12 text-center dark:border-slate-700 dark:bg-slate-900"><FileClock className="mx-auto h-7 w-7 text-slate-400" /><h2 className="mt-4 text-base font-bold">No persisted Cyber Fusion analysis</h2><p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-slate-500">Run a shadow analysis against the persisted telemetry cutoff. This cannot execute remediation or declare a confirmed cause.</p><button type="button" onClick={analyze} disabled={analyzing} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-60"><SearchCheck className="h-4 w-4" />Run first shadow analysis</button></section>}

        {analysis && analysis.cases.length === 0 && <section className="mt-5 rounded-lg border border-slate-200 bg-white px-6 py-10 text-center dark:border-slate-800 dark:bg-slate-900"><CircleDot className="mx-auto h-7 w-7 text-slate-400" /><h2 className="mt-4 text-base font-bold">No correlation case formed</h2><p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-slate-500">Persisted inputs did not meet deterministic grouping rules. This is not evidence that the environment is secure.</p>{analysis.limitations.length > 0 && <p className="mx-auto mt-3 max-w-2xl rounded bg-amber-50 p-3 text-[10px] leading-4 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">{analysis.limitations.join(" ")}</p>}</section>}

        {analysis && currentCase && <>
          <section aria-labelledby="case-heading" className="mt-5 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">Investigation case
                <select value={currentCase.id} onChange={(event) => setSelectedCaseId(event.target.value)} className="mt-1.5 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 dark:border-slate-700 dark:bg-slate-950 lg:w-[32rem]">
                  {analysis.cases.map((item) => <option key={item.id} value={item.id}>{item.incidentId || "Unlinked observation"} · {item.canonicalCiId}</option>)}
                </select>
              </label>
              <div className="text-left lg:text-right"><p className="text-[10px] font-semibold text-slate-500">Analysis cutoff</p><p className="mt-1 font-mono text-xs" title={formatTimestamp(analysis.snapshotCutoff)}>{formatAge(analysis.snapshotCutoff)}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2"><span className="rounded border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-800 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300">{currentCase.incidentId || "No incident link"}</span><span className="rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px] text-slate-600 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300">{currentCase.canonicalCiId}</span><span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">UNCONFIRMED</span></div>
          </section>

          <section aria-labelledby="case-heading" className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="grid lg:grid-cols-3">
              <article className="border-b border-slate-200 p-5 dark:border-slate-800 lg:border-b-0 lg:border-r"><p className="text-[10px] font-semibold text-blue-700 dark:text-blue-300">1 · Observed signals</p><div className="mt-3 flex flex-wrap gap-2">{severity && <span className={`rounded border px-2 py-1 text-[10px] font-semibold ${severityTone[severity]}`}>Highest: {severity}</span>}<span className={`rounded border px-2 py-1 text-[10px] font-semibold ${freshnessTone[evidenceFreshness]}`}>{evidenceFreshness}</span></div><p className="mt-3 text-sm font-bold">{currentCase.evidence.length} signals from {caseSources} source{caseSources === 1 ? "" : "s"}</p><ul className="mt-3 space-y-2">{currentCase.evidence.slice(0, 3).map((item) => <li key={item.id} className="flex items-start gap-2 text-xs leading-5 text-slate-600 dark:text-slate-400"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />{item.summary}</li>)}</ul>{currentCase.evidence.length === 0 && <p className="mt-2 text-xs text-slate-500">No evidence persisted for this case.</p>}</article>
              <article className="border-b border-slate-200 p-5 dark:border-slate-800 lg:border-b-0 lg:border-r"><p className="text-[10px] font-semibold text-violet-700 dark:text-violet-300">2 · Leading assessment</p>{topHypothesis ? <><div className="mt-3 flex items-center gap-2"><span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">UNCONFIRMED</span><span className="font-mono text-[10px] text-slate-500">{Math.round(scorePercent(topHypothesis.confidenceScore))}/100 correlation</span></div><h2 id="case-heading" className="mt-3 text-base font-bold leading-6">{topHypothesis.title}</h2><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">{topHypothesis.explanation}</p><p className="mt-3 text-[10px] text-slate-500">{scoreTier(topHypothesis.confidenceScore)} · not a trained-model probability</p></> : <><h2 id="case-heading" className="mt-3 text-base font-bold">Insufficient evidence to rank an assessment</h2><p className="mt-2 text-xs text-slate-500">No hypothesis explanation was produced.</p></>}</article>
              <article className="p-5"><p className="text-[10px] font-semibold text-amber-800 dark:text-amber-300">3 · Safe next step</p><div className="mt-3 flex w-fit items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"><Ban className="h-3 w-3" />SHADOW ONLY · NOT EXECUTABLE</div><h2 className="mt-3 text-base font-bold leading-6">{safeProposal?.title || "Validate the evidence path"}</h2><p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-400">{safeProposal?.description || "Confirm timestamps, identity evidence, change history, and the physical or logical dependency path before declaring cause."}</p><p className="mt-3 flex items-start gap-2 text-[10px] leading-4 text-amber-900 dark:text-amber-300"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />This recommendation is an analysis artifact. Cyber Fusion cannot approve or execute it.</p></article>
            </div>
          </section>

          {(missingCoverage > 0 || evidenceFreshness === "STALE") && <section aria-label="Incomplete evidence coverage" className="mt-4 flex items-start gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><h2 className="text-xs font-semibold">Incomplete evidence coverage</h2><p className="mt-1 text-[10px] leading-4">{missingCoverage > 0 ? `${missingCoverage} expected connector${missingCoverage === 1 ? " is" : "s are"} missing or unavailable. ` : ""}{evidenceFreshness === "STALE" ? "This case contains stale evidence. " : ""}Scores are constrained by available inputs and are not security assurance.</p></div></section>}

          <section aria-label="Cyber Fusion technical disclosures" className="mt-5 space-y-3">
            <details className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 sm:px-5"><span className="flex-1">Raw evidence & provenance</span><span className="text-[10px] font-normal text-slate-500">{currentCase.evidence.length} records</span><DisclosureChevron /></summary><div className="border-t border-slate-200 p-4 dark:border-slate-800 sm:p-5"><dl className="mb-4 grid gap-3 rounded bg-slate-50 p-3 text-[10px] dark:bg-slate-950 sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-slate-500">Case ID</dt><dd className="mt-0.5 break-all font-mono">{currentCase.id}</dd></div><div><dt className="text-slate-500">CI resolution</dt><dd className="mt-0.5 font-semibold">{currentCase.cmdbResolution.replaceAll("_", " ")}</dd></div><div><dt className="text-slate-500">Canonical CI</dt><dd className="mt-0.5 break-all font-mono">{currentCase.canonicalCiId}</dd></div><div><dt className="text-slate-500">Analysis cutoff</dt><dd className="mt-0.5 font-mono">{formatTimestamp(analysis.snapshotCutoff)}</dd></div></dl><EvidenceDetail evidence={currentCase.evidence} topHypothesis={topHypothesis} /></div></details>

            <details className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 sm:px-5"><span className="flex-1">Competing hypotheses & score detail</span><span className="text-[10px] font-normal text-slate-500">{currentCase.hypotheses.length} ranked</span><DisclosureChevron /></summary><div className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-800 sm:p-5">{[...currentCase.hypotheses].sort((a, b) => a.rank - b.rank).map((hypothesis) => <HypothesisDetail key={hypothesis.id} hypothesis={hypothesis} primary={hypothesis.id === currentCase.topHypothesisId} />)}{currentCase.hypotheses.length === 0 && <p className="rounded border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700">No hypotheses were produced from the persisted evidence.</p>}</div></details>

            <details className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 sm:px-5"><span className="flex-1">Shadow proposal details</span><span className="text-[10px] font-normal text-amber-700 dark:text-amber-300">No execution controls</span><DisclosureChevron /></summary><div className="space-y-3 border-t border-slate-200 p-4 dark:border-slate-800 sm:p-5">{currentCase.shadowProposals.map((proposal) => <ProposalDetail key={proposal.id} proposal={proposal} canonicalCiId={currentCase.canonicalCiId} />)}{currentCase.shadowProposals.length === 0 && <p className="flex items-start gap-2 rounded border border-dashed border-slate-300 p-4 text-xs text-slate-500 dark:border-slate-700"><Ban className="mt-0.5 h-4 w-4 shrink-0" />No shadow proposal was generated.</p>}</div></details>

            <details className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 sm:px-5"><span className="flex-1">Digital Twin assignments</span><span className="text-[10px] font-normal text-slate-500">All six domains</span><DisclosureChevron /></summary><div className="grid border-t border-slate-200 dark:border-slate-800 md:grid-cols-2">{departments.map((department) => { const assignment = currentCase.twinAssignments.find((item) => item.department === department); const status = assignment?.status || "WATCHING"; return <article key={department} className="border-b border-slate-100 p-4 odd:md:border-r dark:border-slate-800"><div className="flex items-center justify-between gap-3"><h3 className="text-xs font-bold">{department} Twin</h3><span className={`rounded border px-2 py-1 text-[10px] font-semibold ${status === "ACTIVE" ? "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300" : "border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>{status}</span></div><p className="mt-2 text-xs leading-5 text-slate-700 dark:text-slate-300">{assignment?.investigationObjective || "Observe shared evidence and await a domain-relevant signal."}</p><p className="mt-1 text-[10px] leading-4 text-slate-500">{assignment?.rationale || "Shared context synchronized; no domain finding asserted."}</p><p className="mt-2 font-mono text-[10px] text-slate-500">{assignment?.relevantEvidenceIds.length || 0} linked evidence records</p></article>; })}</div></details>

            <details className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 sm:px-5"><span className="flex-1">Connector coverage</span><span className="text-[10px] font-normal text-slate-500">{coveragePercent ?? "—"}% usable</span><DisclosureChevron /></summary><div className="border-t border-slate-200 p-4 dark:border-slate-800 sm:p-5"><div className="h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800"><div className="h-full bg-blue-600" style={{ width: `${coveragePercent || 0}%` }} /></div><div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">{analysis.coverage.expectedConnectors.map((source) => { const usable = analysis.coverage.usableConnectors.includes(source); const stale = analysis.coverage.staleConnectors.includes(source); const unavailable = analysis.coverage.unavailableConnectors.includes(source); const simulated = analysis.coverage.simulatedConnectors.includes(source); const status = unavailable ? "UNAVAILABLE" : stale ? "STALE" : usable ? "USABLE" : "MISSING"; return <div key={source} className="flex items-center justify-between gap-3 py-3 text-xs"><span className="font-semibold">{connectorLabels[source]}</span><span className={`rounded border px-2 py-1 text-[10px] font-semibold ${unavailable || !usable ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300" : stale || simulated ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300" : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300"}`}>{status}{simulated ? " · SIMULATION" : ""}</span></div>; })}</div><p className="mt-3 flex items-start gap-2 rounded bg-slate-50 p-3 text-[10px] leading-4 text-slate-500 dark:bg-slate-950"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />Unavailable coverage is unknown—never healthy, secure, or zero.</p></div></details>

            <details className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 sm:px-5"><span className="flex-1">Recorded limitations</span><span className="text-[10px] font-normal text-slate-500">{new Set([...currentCase.limitations, ...analysis.limitations, ...(topHypothesis?.limitations || [])]).size}</span><DisclosureChevron /></summary><div className="border-t border-slate-200 p-4 dark:border-slate-800 sm:p-5"><ul className="space-y-2">{[...new Set([...currentCase.limitations, ...analysis.limitations, ...(topHypothesis?.limitations || [])])].map((limitation) => <li key={limitation} className="flex items-start gap-2 text-xs leading-5 text-slate-600 dark:text-slate-400"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{limitation}</li>)}</ul>{new Set([...currentCase.limitations, ...analysis.limitations, ...(topHypothesis?.limitations || [])]).size === 0 && <p className="text-xs text-slate-500">No explicit limitations were recorded. Operator validation is still required.</p>}</div></details>

            <details className="group overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900"><summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 sm:px-5"><span className="flex-1">Integrity hashes & deterministic replay</span><span className="text-[10px] font-normal text-slate-500">Latest 10 baselines</span><DisclosureChevron /></summary><div className="grid gap-5 border-t border-slate-200 p-4 dark:border-slate-800 sm:p-5 lg:grid-cols-2"><dl className="space-y-3 text-[10px]"><div><dt className="text-slate-500">Analysis ID</dt><dd className="mt-0.5 break-all font-mono font-semibold">{analysis.analysisId}</dd></div><div><dt className="text-slate-500">Combined input fingerprint</dt><dd className="mt-0.5 break-all font-mono" title={analysis.inputHashes.combined}>{shortHash(analysis.inputHashes.combined)}</dd></div><div><dt className="text-slate-500">Snapshot / incidents inputs</dt><dd className="mt-0.5 break-all font-mono">{shortHash(analysis.inputHashes.snapshot)} / {shortHash(analysis.inputHashes.incidents)}</dd></div><div><dt className="text-slate-500">Integrity hash</dt><dd className="mt-0.5 break-all font-mono" title={analysis.integrityHash}>{shortHash(analysis.integrityHash)}</dd></div><div><dt className="text-slate-500">Engine</dt><dd className="mt-0.5 font-mono">{analysis.engineKind} · {analysis.analysisVersion}</dd></div></dl><div><label className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">Recent persisted baseline<select value={replayTargetId} onChange={(event) => setReplayTargetId(event.target.value)} className="mt-1.5 block min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-950">{recentAnalyses.map((item) => <option key={item.analysisId} value={item.analysisId}>{item.analysisId} · {formatTimestamp(item.snapshotCutoff)} · {item.caseCount} case{item.caseCount === 1 ? "" : "s"}</option>)}</select></label><button type="button" onClick={replay} disabled={replaying || !replayTargetId} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-800 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300"><RotateCcw className={`h-4 w-4 ${replaying ? "animate-spin" : ""}`} />{replaying ? "Replaying persisted inputs" : "Run deterministic replay"}</button><p className="mt-2 text-[10px] leading-4 text-slate-500">Replay uses the exact persisted inputs. It does not recollect telemetry or perform remediation.</p></div></div>{state?.latestReplay && <div className={`border-t px-4 py-3 text-xs sm:px-5 ${state.latestReplay.equivalent ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"}`}><p className="flex items-center gap-2 font-semibold">{state.latestReplay.equivalent ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}{state.latestReplay.equivalent ? "Replay equivalent" : "Replay divergence detected"}</p><p className="mt-1 break-all font-mono text-[10px]">Baseline {shortHash(state.latestReplay.baselineIntegrityHash)} · replay {shortHash(state.latestReplay.replayIntegrityHash)} · changed cases {state.latestReplay.changedCaseIds.length}</p></div>}</details>
          </section>

          <button type="button" onClick={() => setActiveTab("dashboard")} className="mt-5 inline-flex min-h-11 w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"><span className="flex items-center gap-2"><Activity className="h-4 w-4 text-blue-600" />Return to operations overview</span><ArrowRight className="h-4 w-4" /></button>
        </>}

        <footer className="mt-6 flex flex-col gap-2 border-t border-slate-200 py-4 text-[10px] text-slate-500 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between"><span>Explainable rules + CI graph · no trained-model probability · no execution controls</span><span className="flex items-center gap-1.5"><Fingerprint className="h-3.5 w-3.5" />Persisted inputs are integrity-hashed for replay</span></footer>
      </div>
    </main>
  );
}
