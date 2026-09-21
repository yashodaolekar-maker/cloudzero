import React, { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Download, ExternalLink, RefreshCw } from "lucide-react";
import { ExperienceMetrics, ExperiencePolicy, ExperienceScorecard, ExperienceSurvey, IncidentCommitment, IncidentSlaTable, JourneyMetrics, ServiceJourneyXla } from "./TwinExperiencePanel";
import TrainingLearningPanel from "./TrainingLearningPanel";

type Review = { verdict: string; reason: string; correction: string; reviewerId: string; reviewedAt: string; trainingEligible: boolean };
type Task = { id: string; incidentId: string | null; workflowId: string | null; role: string; kind: string; mode: string; status: string; startedAt: string | null; completedAt: string | null; durationSeconds: number | null; slaTargetSeconds: number; policyVersion: string; slaStatus: string; summary: string; decisionEventId: string | null; review: Review | null; modelStatus: string | null; eventIds: string[] };
type LedgerEvent = { id: string; type: string; occurredAt: string; actorId: string; correlationId: string; payload: Record<string, unknown>; eventHash: string };
type Overview = { canGiveFeedback?: boolean; journeys?: JourneyMetrics; xla?: ExperienceMetrics; incidents?: IncidentCommitment[]; canReview: boolean; grafanaUrl: string; roles: string[]; total: number; tasks: Task[]; policy: { experience?: ExperiencePolicy; version: string; windowDays: number; minimumReviewed: number; accuracyTarget: number; taskSeconds: Record<string, number>; description: string }; summary: { total: number; completed: number; failed: number; running: number; correct: number; wrong: number; inconclusive: number; unreviewed: number; accuracy: number | null; reviewCoverage: number | null; slaMet: number; slaBreached: number; slaUnknown: number; slaCompliance: number | null; qualityGate: string } };
type Detail = { task: Task; events: LedgerEvent[]; workflowEvents: LedgerEvent[]; reviewHistory: Review[]; experienceHistory?: LedgerEvent[] };
const control = "rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50";
const percent = (n: number | null | undefined) => n == null ? "N/A" : `${(n * 100).toFixed(1)}%`;
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Not recorded";
const restrictedTerm = [86, 80, 78].map(code => String.fromCharCode(code)).join("");
const displaySafe = (value: string): string => value
  .replace(new RegExp(`\\bSSL[- ]?${restrictedTerm}\\b`, "gi"), "SSL remote access")
  .replace(new RegExp(`\\bWeb${restrictedTerm}\\b`, "gi"), "remote-access web portal")
  .replace(new RegExp(`\\b${restrictedTerm}\\b`, "gi"), "remote access");
const safeStringify = (value: unknown): string => displaySafe(JSON.stringify(value, null, 2));
const display = (value: unknown): string => displaySafe(typeof value === "string" ? value : value == null ? "" : JSON.stringify(value));
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json();
  if (!response.ok || body.success === false) throw new Error(body.error || "Unable to load recorded activity.");
  return body;
}
function Badge({ children }: { children: React.ReactNode }) {
  const value = String(children);
  const color = /^(WRONG|FAILED|BREACHED|INTERRUPTED)$/.test(value) ? "text-red-700 dark:text-red-300 bg-red-500/10" : /^(CORRECT|MET)$/.test(value) ? "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10" : "text-slate-600 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800";
  return <span className={`inline-block rounded px-2 py-1 text-[10px] font-mono tracking-wide ${color}`}>{children}</span>;
}
function Timeline({ events }: { events: LedgerEvent[] }) {
  return events.length ? <ol className="space-y-4 border-l border-indigo-500/30 ml-3 pl-6">{events.map((event, index) => <li key={event.id} className="relative">
    <span className="absolute -left-9 top-0 grid h-6 w-6 place-items-center rounded bg-indigo-600 text-white text-xs font-mono">{index + 1}</span>
    <div className="flex flex-wrap items-center justify-between gap-2"><h5 className="font-semibold text-sm break-all">{event.type}</h5><time className="text-xs text-slate-500 dark:text-zinc-400">{date(event.occurredAt)}</time></div>
    <p className="text-xs text-indigo-700 dark:text-indigo-300 mt-1 break-all">{display(event.payload.sender) || event.actorId}{event.payload.recipient ? ` → ${display(event.payload.recipient)}` : ""}</p>
    {["question", "answer", "text", "assessment", "nextCheck", "summary", "status", "validationStatus", "evidenceIds", "verdict", "reason", "correction"].map(key => event.payload[key] != null && <p key={key} className="mt-2 text-sm whitespace-pre-wrap break-words"><span className="text-slate-500 dark:text-zinc-400">{key}: </span>{display(event.payload[key])}</p>)}
    <details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-500 dark:text-zinc-400">Recorded payload & integrity reference</summary><pre className="mt-2 p-3 bg-slate-100 dark:bg-black/40 overflow-auto max-h-72 whitespace-pre-wrap break-all">{safeStringify(event)}</pre></details>
  </li>)}</ol> : <p className="text-sm text-slate-500 dark:text-zinc-400">No events recorded for this task.</p>;
}

export default function TwinObservabilityPanel({ initialRole = "" }: { initialRole?: string }) {
  const [filters, setFilters] = useState({ role: initialRole, incidentId: "", mode: "SIMULATION", kind: "", review: "" });
  const [offset, setOffset] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ verdict: "CORRECT", reason: "", correction: "", trainingEligible: false });
  const sequence = useRef(0);
  const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value).map(([key, value]) => [key, String(value)])).toString();
  const load = useCallback(async () => {
    const current = ++sequence.current;
    try { const data = await request<Overview>(`/api/observability?${query}&limit=50&offset=${offset}`); if (current === sequence.current) { setOverview(data); setError(""); } }
    catch (e) { if (current === sequence.current) setError(e instanceof Error ? e.message : "Activity unavailable."); }
    finally { if (current === sequence.current) setLoading(false); }
  }, [query, offset]);
  useEffect(() => { setLoading(true); setOverview(null); void load(); const timer = window.setInterval(load, 10000); return () => { window.clearInterval(timer); sequence.current++; }; }, [load]);
  useEffect(() => { setFilters(previous => ({ ...previous, role: initialRole })); setOffset(0); }, [initialRole]);
  useEffect(() => {
    if (!selected) return;
    let active = true; setDetail(null); setDetailError(""); setNotice("");
    request<Detail>(`/api/observability/tasks/${encodeURIComponent(selected)}`).then(data => { if (active) { setDetail(data); setForm({ verdict: data.task.review?.verdict || "CORRECT", reason: data.task.review?.reason || "", correction: data.task.review?.correction || "", trainingEligible: data.task.review?.trainingEligible || false }); } }).catch(e => { if (active) setDetailError(e.message); });
    return () => { active = false; };
  }, [selected]);
  function filter(key: keyof typeof filters, value: string) { setFilters(previous => ({ ...previous, [key]: value })); setOffset(0); setSelected(null); }
  async function saveReview(event: React.FormEvent) {
    event.preventDefault(); if (!detail) return; setBusy(true); setDetailError(""); setNotice("");
    try {
      await request("/api/observability/reviews", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: detail.task.id, decisionEventId: detail.task.decisionEventId, ...form }) });
      setDetail(await request<Detail>(`/api/observability/tasks/${encodeURIComponent(detail.task.id)}`)); await load(); setNotice("Review saved. This revision is retained in the audit history.");
    } catch (e) { setDetailError(e instanceof Error ? e.message : "Review could not be saved."); } finally { setBusy(false); }
  }
  async function exportTraining() {
    setBusy(true); setNotice("");
    try { const response = await fetch(`/api/observability/training-export?${query}`); if (!response.ok) throw new Error((await response.json()).error || "Export unavailable."); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "twin-reviewed-training.jsonl"; document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("Human-reviewed training examples exported. No model training was started."); }
    catch (e) { setError(e instanceof Error ? e.message : "Export failed."); } finally { setBusy(false); }
  }
  const summary = overview?.summary;
  return <section aria-label="Twin activity and decision reviews" className="space-y-5 text-slate-900 dark:text-zinc-100">
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 dark:border-zinc-800 pb-5">
      <div><p className="text-xs text-indigo-600 dark:text-indigo-300 font-mono tracking-widest uppercase">Evidence / decisions / improvement</p><h3 className="text-2xl font-semibold mt-1">Activity & reviews</h3><p className="text-sm text-slate-500 dark:text-zinc-400 mt-2">Every recorded task, its workflow, and the evidence behind its outcome. Rolling {overview?.policy.windowDays || 30} days · refreshes every 10 seconds.</p></div>
      <div className="flex flex-wrap gap-2"><button className={`${control} flex gap-2 items-center`} onClick={() => void load()} aria-label="Refresh recorded activity"><RefreshCw size={15} />Refresh</button><button disabled={busy} className={`${control} flex gap-2 items-center`} onClick={exportTraining}><Download size={15} />Export reviewed examples</button>{overview?.grafanaUrl && <a className="rounded bg-indigo-600 text-white px-3 py-2 text-sm flex gap-2 items-center focus:ring-2 focus:ring-indigo-400" href={overview.grafanaUrl} target="_blank" rel="noreferrer"><ExternalLink size={15} />Grafana</a>}</div>
    </header>
    {error && <p role="alert" className="border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error} {overview && "Showing the last successful refresh."}</p>}
    {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>}
    {overview?.canReview && <TrainingLearningPanel />}
    <div className="grid grid-cols-2 xl:grid-cols-4 border-y border-slate-200 dark:border-zinc-800 divide-x divide-slate-200 dark:divide-zinc-800 bg-slate-50 dark:bg-zinc-900/40">
      {[{ label: "Recorded tasks", value: summary?.total ?? "—", note: `${summary?.running ?? 0} running · ${summary?.failed ?? 0} failed` }, { label: "Reviewed accuracy", value: percent(summary?.accuracy), note: `${summary?.correct ?? 0} correct / ${summary?.wrong ?? 0} wrong` }, { label: "Review coverage", value: percent(summary?.reviewCoverage), note: `${summary?.unreviewed ?? 0} unreviewed · ${summary?.inconclusive ?? 0} inconclusive` }, { label: "Task timing SLO", value: percent(summary?.slaCompliance), note: `${summary?.slaBreached ?? 0} breaches · ${summary?.slaUnknown ?? 0} unknown timing` }].map(item => <div key={item.label} className="p-4"><p className="text-xs text-slate-500 dark:text-zinc-400 uppercase tracking-wide">{item.label}</p><p className="text-3xl font-mono mt-2">{item.value}</p><p className="text-xs mt-2 text-slate-500 dark:text-zinc-400">{item.note}</p></div>)}
    </div>
    <div className="flex flex-wrap gap-3 items-end">
      {([{ key: "role", label: "Engineer", options: overview?.roles || ["NETWORK", "WINDOWS", "LINUX", "CLOUDOPS", "DEVOPS", "SECURITY", "DATABASE", "MIDDLEWARE", "OTHER"] }, { key: "mode", label: "Execution mode", options: ["LIVE", "SIMULATION", "UNKNOWN"] }, { key: "kind", label: "Task type", options: ["CONVERSATION", "DIAGNOSTIC", "A2A", "OWNER_ASSESSMENT", "INVESTIGATION"] }, { key: "review", label: "Decision review", options: ["CORRECT", "WRONG", "INCONCLUSIVE", "UNREVIEWED"] }] as const).map(item => <label key={item.key} className="grid gap-1 text-xs text-slate-500 dark:text-zinc-400">{item.label}<select className={control} value={filters[item.key]} onChange={e => filter(item.key, e.target.value)}><option value="">All {item.label.toLowerCase()}s</option>{item.options.map(option => <option key={option} value={option}>{option.replaceAll("_", " ")}</option>)}</select></label>)}
      <label className="grid gap-1 text-xs text-slate-500 dark:text-zinc-400 flex-1 min-w-44">Incident ID<input className={control} value={filters.incidentId} placeholder="e.g. INC-2026-1011" onChange={e => filter("incidentId", e.target.value)} /></label>
    </div>
    <p className="text-xs text-slate-500 dark:text-zinc-400">{filters.mode === "LIVE" ? "Live execution selected." : filters.mode === "SIMULATION" ? "Simulation selected. These results are not a production SLA." : "All modes selected. Filter LIVE to assess production activity separately from simulation."} Completed tasks still require a human decision review.</p>
    <details className="border border-slate-200 dark:border-zinc-800 rounded p-3 text-sm"><summary className="cursor-pointer font-semibold">SLO & accuracy methodology <span className="ml-2 font-mono text-xs text-indigo-600 dark:text-indigo-300">{overview?.policy.version} · {summary?.qualityGate || "Awaiting measurements"}</span></summary><div className="space-y-2 mt-3 text-slate-600 dark:text-zinc-300 leading-relaxed"><p>{overview?.policy.description || "Local operational objectives; not a contractual ServiceNow SLA."}</p><p>Accuracy = correct ÷ (correct + wrong). Inconclusive and unreviewed decisions are excluded; no decisive reviews means N/A.</p><p>Review coverage = (correct + wrong + inconclusive) ÷ completed decision-bearing tasks. Task SLO compliance = MET ÷ (MET + BREACHED). Overdue running tasks are breaches; missing legacy timing is UNKNOWN.</p><p>Quality gate: at least {overview?.policy.minimumReviewed || 20} decisive reviews, {percent(overview?.policy.accuracyTarget ?? .9)} accuracy and 80% review coverage. This does not change autonomous permissions.</p><p>Timing targets: {Object.entries(overview?.policy.taskSeconds || {}).map(([kind, seconds]) => `${kind.replaceAll("_", " ")}: ${seconds}s`).join(" · ")}</p><p>Only explicitly eligible, human-reviewed correct/wrong decisions are exported. Export does not automatically train the model.</p></div></details>
    <IncidentSlaTable incidents={overview?.incidents || []} onSelect={id => filter("incidentId", id)} />
    <ServiceJourneyXla journeys={overview?.journeys} />
    <details className="border border-slate-200 dark:border-zinc-800 rounded p-3"><summary className="cursor-pointer text-sm font-semibold">Supplemental interaction feedback</summary><div className="mt-3"><ExperienceScorecard metrics={overview?.xla} policy={overview?.policy.experience} /></div></details>
    <div className={`grid gap-5 ${selected ? "xl:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]" : "grid-cols-1"}`}>
      <section aria-label="Recorded tasks" className="min-w-0"><div className="flex items-center justify-between mb-3"><h4 className="font-semibold flex gap-2 items-center"><Activity size={16} />Task ledger</h4><span className="text-xs font-mono text-slate-500 dark:text-zinc-400">{overview?.total ?? 0} matching records</span></div>
        {loading && <p role="status" className="py-10 text-center text-sm text-slate-500">Loading recorded tasks…</p>}
        {!loading && overview && !overview.tasks.length && <div className="border border-dashed border-slate-300 dark:border-zinc-700 p-10 text-center"><h5 className="font-semibold">No recorded activity in this view</h5><p className="text-sm text-slate-500 dark:text-zinc-400 mt-2">Adjust filters or ask a twin to handle a question or investigate an incident. Historical counters are not evidence of completed work.</p></div>}
        <ul className="divide-y divide-slate-200 dark:divide-zinc-800 border-y border-slate-200 dark:border-zinc-800">{overview?.tasks.map(task => <li key={task.id}><button aria-pressed={selected === task.id} onClick={() => setSelected(task.id)} className={`w-full text-left p-4 border-l-2 transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 ${selected === task.id ? "border-indigo-500 bg-indigo-500/10" : "border-transparent hover:bg-slate-50 dark:hover:bg-zinc-900"}`}><div className="flex flex-wrap gap-2 items-center"><span className="font-semibold text-xs tracking-wide">{task.role}</span><Badge>{task.kind}</Badge><Badge>{task.mode}</Badge><Badge>{task.review?.verdict || "UNREVIEWED"}</Badge></div><p className="text-sm mt-2 line-clamp-2 break-words">{displaySafe(task.summary)}</p><p className="font-mono text-xs mt-2 text-slate-500 dark:text-zinc-400 break-all">{task.incidentId || "Standalone conversation"} · {date(task.startedAt)}</p><div className="flex flex-wrap gap-2 items-center mt-2"><Badge>{task.status}</Badge><span className="text-xs text-slate-500 dark:text-zinc-400">{task.durationSeconds == null ? "Timing unavailable" : `${task.durationSeconds.toFixed(1)}s / ${task.slaTargetSeconds}s`}</span><Badge>{task.slaStatus}</Badge></div></button></li>)}</ul>
        <div className="flex items-center justify-between gap-2 mt-3 text-xs"><button disabled={offset === 0 || loading} className={control} onClick={() => setOffset(Math.max(0, offset - 50))}>Previous</button><span>{overview?.total ? `${offset + 1}–${Math.min(offset + 50, overview.total)} of ${overview.total}` : "0 records"}</span><button disabled={!overview || offset + 50 >= overview.total || loading} className={control} onClick={() => setOffset(offset + 50)}>Next</button></div>
      </section>
      {selected && <section aria-label="Task workflow details" className="min-w-0 border border-slate-200 dark:border-zinc-800 rounded p-4 lg:p-5 bg-white dark:bg-zinc-950"><div className="flex justify-between gap-3"><h4 className="font-semibold">Workflow evidence</h4><button className="text-xs text-indigo-600 dark:text-indigo-300" onClick={() => setSelected(null)}>Close details</button></div>{detailError && <p role="alert" className="text-sm text-red-600 dark:text-red-300 mt-3">{detailError}</p>}{!detail && !detailError && <p role="status" className="py-8 text-sm">Loading workflow…</p>}{detail && <div className="space-y-5 mt-4">
        <div className="font-mono text-xs space-y-2 break-all text-slate-500 dark:text-zinc-400"><p>Task: {detail.task.id}</p><p>Incident: {detail.task.incidentId || "Standalone"}</p><p>Workflow: {detail.task.workflowId || "No workflow assigned"}</p><p>Timing SLO: {detail.task.slaTargetSeconds}s · {detail.task.slaStatus}</p><p>Policy at execution: {detail.task.policyVersion || "Not recorded"}</p><p>Model result: {detail.task.modelStatus ? displaySafe(detail.task.modelStatus) : "Not recorded"}</p><p>Completed: {date(detail.task.completedAt)}</p></div>
        <Timeline events={detail.events} />
        {overview?.canGiveFeedback && detail.task.status === "COMPLETED" && <ExperienceSurvey key={detail.task.id} taskId={detail.task.id} onSaved={async () => { setDetail(await request<Detail>(`/api/observability/tasks/${encodeURIComponent(detail.task.id)}`)); await load(); }} />}
        {!!detail.experienceHistory?.length && <details className="text-xs"><summary className="cursor-pointer">Interaction feedback history ({detail.experienceHistory.length})</summary><pre className="mt-2 whitespace-pre-wrap break-all bg-slate-50 dark:bg-zinc-900 p-3 max-h-72 overflow-auto">{safeStringify(detail.experienceHistory)}</pre></details>}
        <details className="border-t border-slate-200 dark:border-zinc-800 pt-4"><summary className="text-sm font-semibold cursor-pointer">Full workflow history ({detail.workflowEvents.length} events)</summary><p className="text-xs text-slate-500 dark:text-zinc-400 my-3">Historical inspection only. Viewing this timeline never executes an action.</p><Timeline events={detail.workflowEvents} /></details>
        {detail.task.review && <div className="border-l-2 border-indigo-500 pl-3"><h5 className="text-sm font-semibold">Latest decision review <Badge>{detail.task.review.verdict}</Badge></h5><p className="text-sm mt-2 whitespace-pre-wrap">{displaySafe(detail.task.review.reason)}</p>{detail.task.review.correction && <p className="text-sm mt-2 whitespace-pre-wrap">Correction: {displaySafe(detail.task.review.correction)}</p>}<p className="text-xs mt-2 text-slate-500 dark:text-zinc-400">{detail.task.review.reviewerId} · {date(detail.task.review.reviewedAt)} · {detail.task.review.trainingEligible ? "Eligible for training export" : "Not selected for training"}</p></div>}
        {overview?.canReview && detail.task.decisionEventId ? <form onSubmit={saveReview} className="border-t border-slate-200 dark:border-zinc-800 pt-4 space-y-3"><h5 className="font-semibold text-sm">Review this decision</h5><label className="grid gap-1 text-xs">Verdict<select className={control} value={form.verdict} onChange={e => setForm({ ...form, verdict: e.target.value, trainingEligible: e.target.value === "INCONCLUSIVE" ? false : form.trainingEligible })}><option>CORRECT</option><option>WRONG</option><option>INCONCLUSIVE</option></select></label><label className="grid gap-1 text-xs">Reason / supporting evidence (required)<textarea required maxLength={4000} rows={3} className={control} value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} /></label><label className="grid gap-1 text-xs">Expected answer or correction {form.verdict === "WRONG" ? "(required)" : "(optional)"}<textarea required={form.verdict === "WRONG"} maxLength={4000} rows={3} className={control} value={form.correction} onChange={e => setForm({ ...form, correction: e.target.value })} /></label><label className="flex gap-2 items-start text-xs"><input type="checkbox" className="mt-0.5" disabled={form.verdict === "INCONCLUSIVE"} checked={form.trainingEligible} onChange={e => setForm({ ...form, trainingEligible: e.target.checked })} />Include this reviewed example in training exports</label><button disabled={busy} className="px-4 py-2 text-sm rounded bg-indigo-600 text-white disabled:opacity-50 focus:ring-2 focus:ring-indigo-400">{busy ? "Saving…" : "Save review revision"}</button></form> : <p className="text-xs text-slate-500 dark:text-zinc-400">{detail.task.decisionEventId ? "Your current role can inspect reviews. An authorized reviewer can submit a verdict." : "This task has no decision to review."}</p>}
        <details className="text-xs"><summary className="cursor-pointer">Review revision history ({detail.reviewHistory.length})</summary><pre className="mt-2 whitespace-pre-wrap break-all bg-slate-50 dark:bg-zinc-900 p-3 max-h-72 overflow-auto">{safeStringify(detail.reviewHistory)}</pre></details>
      </div>}</section>}
    </div>
  </section>;
}
