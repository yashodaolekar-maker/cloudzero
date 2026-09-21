import React, { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Database, ExternalLink, LoaderCircle, Play, RefreshCw } from "lucide-react";

type Session = { id: string; scenarioId: string; title: string; revision: number; state: "FAULTED" | "REPAIRED"; status: "IDLE" | "RUNNING" | "COMPLETED" | "FAILED" | "INTERRUPTED"; incidentId: string; workflowId?: string; createdAt: string; updatedAt: string; lastError?: string };
type Status = { enabled: boolean; ready: boolean; error?: string; scenarios: { id: string; name: string; description: string; roles: string[] }[]; sessions: Session[]; database: { name: string; version: string; readOnlyProxy: boolean }; canOperate: boolean };
type Event = { id: string; type: string; occurredAt: string; payload: Record<string, unknown> };
type BackendRca = { status: "SUPPORTED"; hypothesis: string; finding: string; owner: string; evidenceIds: string[]; eliminated: { role: string; finding: string; evidenceIds: string[] }[] };
type InvestigationSummary = { headline: string; owner: string; blocker: string | null; nextAction: string; rca?: BackendRca; teams: { role: string; status: "PENDING" | "CHECKED" | "BLOCKED"; checked: string; finding: string; evidenceIds: string[] }[]; steps: { id: string; label: string; status: "PENDING" | "ACTIVE" | "COMPLETED" | "BLOCKED"; owner: string; description: string; evidenceIds: string[] }[] };
type Detail = { summary?: InvestigationSummary; session: Session; resources: { id: string; role: string; name: string; state: Record<string, unknown>; updatedAt: string }[]; incidents: { id: string; role: string; record: Record<string, unknown> }[]; changes: { id: string; record: Record<string, unknown> }[]; orders: { id: string; status: string; amount: number }[]; queries: { id: string; templateId: string; persona: string; deviceId: string; observedAt: string; revision: number; output: unknown }[]; events: Event[]; exchanges: Event[]; workNotes: { id: string; text: string; createdAt: string }[]; canOperate: boolean };
const control = "rounded border border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-950 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed";
const action = "rounded bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 disabled:opacity-40 disabled:cursor-not-allowed";
const time = (value: string) => new Date(value).toLocaleString();
const value = (item: unknown) => typeof item === "string" ? item : JSON.stringify(item);
function Json({ data }: { data: unknown }) { return <pre className="text-xs font-mono whitespace-pre-wrap break-all p-3 bg-slate-100 dark:bg-black/30 rounded overflow-auto max-h-72">{JSON.stringify(data, null, 2)}</pre>; }
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/demo${path}`, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data.success === false) throw new Error(`${response.status === 409 ? "Session changed. Refreshed the current revision. " : ""}${data.error || "Demo request failed."}`);
  return data;
}
type VerdictTone = "RED" | "YELLOW" | "GREEN";
function verdictFor(payload: Record<string, unknown>): VerdictTone {
  const text = JSON.stringify(payload).toLowerCase();
  if (payload.validationStatus === "NEEDS_EVIDENCE" || payload.blocked === true || /"blocked":true|failed|error|unreachable|stopped|degraded/.test(text)) return "RED";
  if (payload.validationStatus === "SIMULATED" || /simulat|pending|unknown|unconfirmed/.test(text)) return "YELLOW";
  return "GREEN";
}
function readableAssessment(payload: Record<string, unknown>): string {
  const assessment = typeof payload.assessment === "string" ? payload.assessment : typeof payload.question === "string" ? payload.question : "No readable assessment recorded.";
  const prefix = assessment.indexOf("Sandbox database observations only:");
  if (prefix < 0) return assessment;
  const raw = assessment.slice(prefix + "Sandbox database observations only:".length).trim();
  try {
    const observations = [...raw.matchAll(/"role"\s*:\s*"([^"\\]+)"[\s\S]*?"finding"\s*:\s*"((?:\\.|[^"\\])*)"/g)];
    if (observations.length) return observations.map(match => `${match[1]}: ${match[2].replace(/\\"/g, '"')}`).join(" ");
    return "Recorded sandbox observations require review.";
  } catch {
    return "Recorded sandbox observations require review.";
  }
}
function Verdict({ payload }: { payload: Record<string, unknown> }) {
  const tone = verdictFor(payload);
  const colors = { RED: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300", YELLOW: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", GREEN: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
  const checks = Array.isArray(payload.validationChecks) ? payload.validationChecks.filter(item => item && typeof item === "object") as Record<string, unknown>[] : [];
  return <div className={`mt-2 rounded border p-3 ${colors[tone]}`}><p className="font-bold">FINAL VERDICT: {tone}</p><p className="mt-1 whitespace-pre-wrap">{readableAssessment(payload)}</p>{checks.length > 0 && <details className="mt-3" open><summary className="cursor-pointer text-xs font-bold uppercase">Validation evidence ({checks.length})</summary><div className="mt-2 space-y-2">{checks.map((check, index) => <article key={`${String(check.evidenceId)}-${index}`} className="rounded border border-current/20 p-2"><p className="text-xs font-semibold">{String(check.objective || check.templateId)}</p><code className="mt-1 block whitespace-pre-wrap break-all rounded bg-slate-950 p-2 text-[11px] text-emerald-300">{String(check.command || "Command unavailable")}</code><p className="mt-1 text-xs">{String(check.status)} · evidence {String(check.evidenceId)}</p><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-xs">{String(check.output || "No output recorded")}</pre></article>)}</div></details>}{typeof payload.nextCheck === "string" && <p className="mt-2"><strong>Immediate action:</strong> {payload.nextCheck}</p>}</div>;
}
function WorkNote({ note }: { note: string }) {
  const sections = note.split(/\n(?=[A-Z][A-Z AND]+\n)/).map(section => section.trim()).filter(Boolean);
  return <div className="mt-2 rounded border border-blue-500/30 bg-blue-500/5 p-4 text-sm">{sections.map((section, index) => { const lines = section.split("\n"); return <section key={`${lines[0]}-${index}`} className={index ? "mt-4" : ""}><h6 className="font-bold text-blue-700 dark:text-blue-300">{lines[0]}</h6><div className="mt-1 space-y-1 whitespace-pre-wrap">{lines.slice(1).map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}</div></section>; })}</div>;
}
function executionStatus(payload: Record<string, unknown>) {
  const status = String(payload.status || payload.validationStatus || "RECORDED").toUpperCase();
  if (/FAIL|ERROR|BLOCK|STOPPED|UNREACHABLE|DEGRADED/.test(status)) return { label: "CHECK FOUND A PROBLEM", className: "text-red-700 dark:text-red-300 bg-red-500/10 border-red-500/30" };
  if (/SIMULATED|PENDING|UNKNOWN|NEEDS_EVIDENCE/.test(status)) return { label: "SIMULATED CHECK", className: "text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30" };
  return { label: status === "SUCCEEDED" ? "CHECK COMPLETED" : "RECORDED CHECK", className: "text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 border-emerald-500/30" };
}
function ExecutionSummary({ payload }: { payload: Record<string, unknown> }) {
  const command = typeof payload.commandDisplay === "string" ? payload.commandDisplay : typeof payload.command === "string" ? payload.command : "";
  const objective = typeof payload.objective === "string" ? payload.objective : "Review the evidence for this handoff.";
  const output = typeof payload.output === "string" ? payload.output : "";
  const next = typeof payload.nextCheck === "string" ? payload.nextCheck : "";
  if (!command && !output && !payload.templateId) return null;
  const state = executionStatus(payload);
  const persona = String(payload.persona || payload.sender || "Agent");
  return <div className="mt-3 rounded border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/60 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-bold uppercase tracking-wide">{persona} execution</p><span className={`rounded border px-2 py-1 text-[10px] font-bold ${state.className}`}>{state.label}</span></div>
    <p className="mt-2 text-sm"><strong>What the agent checked:</strong> {objective}</p>
    {command && <div className="mt-3"><p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">Read-only command or diagnostic check</p><code className="mt-1 block whitespace-pre-wrap break-words rounded bg-slate-950 p-3 text-xs text-emerald-300">$ {command}</code></div>}
    {output && <div className="mt-3"><p className="text-xs font-semibold text-slate-500 dark:text-zinc-400">What it returned</p><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-black/20 p-3 text-xs">{output}</pre></div>}
    {next && <p className="mt-3 text-sm"><strong>Next check:</strong> {next}</p>}
  </div>;
}
function Events({ events }: { events: Event[] }) {
  return events.length ? <ol className="space-y-4 border-l border-blue-500/30 ml-3 pl-6">{events.map((event, index) => <li key={event.id} className="relative"><span className="absolute -left-9 top-0 bg-blue-600 text-white rounded w-6 h-6 grid place-items-center text-xs font-mono">{index + 1}</span><div className="flex flex-wrap gap-2 justify-between"><p className="text-sm font-semibold break-all">{event.type}</p><time className="text-xs text-slate-500 dark:text-zinc-400">{time(event.occurredAt)}</time></div>{event.payload.sender != null && <p className="font-mono text-xs text-blue-600 dark:text-blue-300 mt-1">{value(event.payload.sender)} → {value(event.payload.recipient) || "Owner"}</p>}{event.type === "AgentCollaborationWorkNote" && typeof event.payload.note === "string" ? <WorkNote note={event.payload.note} /> : ["AgentValidationReplied", "AgentOwnerAssessmentCompleted"].includes(event.type) ? <Verdict payload={event.payload} /> : typeof event.payload.question === "string" && <p className="mt-2 text-sm">{event.payload.question}</p>}<ExecutionSummary payload={event.payload} /><details className="mt-2 text-xs"><summary className="cursor-pointer text-slate-500 dark:text-zinc-400">Technical details (audit JSON)</summary><div className="mt-2"><Json data={event} /></div></details></li>)}</ol> : <p className="text-sm text-slate-500 dark:text-zinc-400 py-4">No exchanges yet. Start an investigation to observe requests and evidence-based replies.</p>;
}

function RcaHero({ rca, nextAction }: { rca: BackendRca; nextAction: string }) {
  const network = rca.eliminated.find(item => item.role.toUpperCase() === "NETWORK");
  const database = rca.eliminated.find(item => item.role.toUpperCase() === "DATABASE");
  const remaining = rca.eliminated.filter(item => item !== network && item !== database);
  const ordered: Array<{ kind: "ELIMINATED"; item: BackendRca["eliminated"][number] } | { kind: "SUPPORTED" }> = [
    ...(network ? [{ kind: "ELIMINATED" as const, item: network }] : []),
    { kind: "SUPPORTED" },
    ...(database ? [{ kind: "ELIMINATED" as const, item: database }] : []),
    ...remaining.map(item => ({ kind: "ELIMINATED" as const, item })),
  ];
  return <section className="cz-rca-hero" aria-labelledby="a2a-rca-title">
    <div className="cz-rca-heading"><div><p className="cz-section-kicker">Investigation result · backend validated</p><h3 id="a2a-rca-title">Root cause supported</h3></div><span className="cz-rca-status">{rca.status}</span></div>
    <div className="cz-rca-grid"><div className="cz-rca-primary"><p className="cz-rca-label">RCA hypothesis</p><p className="cz-rca-hypothesis">{rca.hypothesis}</p><p className="cz-rca-finding">{rca.finding}</p><dl><div><dt>Owner</dt><dd>{rca.owner}</dd></div><div><dt>Supporting evidence</dt><dd>{rca.evidenceIds.length} incident-bound record{rca.evidenceIds.length === 1 ? "" : "s"}</dd></div></dl></div>
      <div className="cz-rca-chain" aria-label="Incident-bound collaboration and RCA chain">{ordered.map((entry, index) => <React.Fragment key={entry.kind === "SUPPORTED" ? `supported-${rca.owner}` : `eliminated-${entry.item.role}`}>
        {entry.kind === "SUPPORTED" ? <article className="is-supported"><span>{rca.owner}</span><strong>{rca.status}</strong><p>{rca.hypothesis}</p><small>{rca.evidenceIds.length} supporting record{rca.evidenceIds.length === 1 ? "" : "s"}</small></article> : <article className="is-eliminated"><span>{entry.item.role}</span><strong>ELIMINATED</strong><p>{entry.item.finding}</p><small>{entry.item.evidenceIds.length} evidence record{entry.item.evidenceIds.length === 1 ? "" : "s"}</small></article>}
        {index < ordered.length - 1 && <span className="cz-rca-arrow" aria-hidden="true">→</span>}
      </React.Fragment>)}</div></div>
    <div className="cz-rca-next"><span>Next safe action</span><p>{nextAction}</p></div>
    <details className="cz-developer-disclosure"><summary>Developer Details · evidence references</summary><div className="cz-rca-refs"><p><strong>Supporting:</strong> {rca.evidenceIds.join(", ") || "No evidence identifiers recorded."}</p>{rca.eliminated.map(item => <p key={item.role}><strong>{item.role} eliminated:</strong> {item.evidenceIds.join(", ") || "No evidence identifiers recorded."}</p>)}</div></details>
  </section>;
}

function InvestigationStory({ summary, showRca = false }: { summary: InvestigationSummary; showRca?: boolean }) {
  const [selectedStep, setSelectedStep] = useState<string | null>(null);
  const previousStatuses = useRef<Record<string, InvestigationSummary["steps"][number]["status"]>>({});
  const [workflowNotice, setWorkflowNotice] = useState("");
  const activeStep = summary.steps.find(item => item.status === "ACTIVE");
  const nextStep = summary.steps.find(item => item.status === "PENDING");
  const step = summary.steps.find(item => item.id === selectedStep) || activeStep || summary.steps.find(item => item.status === "BLOCKED") || summary.steps[0];
  const tone = (status: string) => status === "BLOCKED" ? "text-amber-800 dark:text-amber-300 bg-amber-500/10" : status === "COMPLETED" || status === "CHECKED" ? "text-emerald-800 dark:text-emerald-300 bg-emerald-500/10" : status === "ACTIVE" ? "text-blue-700 dark:text-blue-300 bg-blue-500/10" : "text-slate-600 dark:text-zinc-400 bg-slate-100 dark:bg-zinc-900";
  const statusLabel = (status: InvestigationSummary["steps"][number]["status"]) => status === "ACTIVE" ? "IN PROGRESS" : status === "COMPLETED" ? "WORK COMPLETED" : status;

  useEffect(() => {
    const completedStep = summary.steps.find(item => previousStatuses.current[item.id] === "ACTIVE" && item.status === "COMPLETED");
    if (completedStep) {
      const followingStep = summary.steps[summary.steps.findIndex(item => item.id === completedStep.id) + 1];
      setWorkflowNotice(followingStep ? `${completedStep.label} work completed. Moving to ${followingStep.label}.` : `${completedStep.label} work completed.`);
    } else if (activeStep) {
      setWorkflowNotice(`${activeStep.label} is in progress.`);
    }
    setSelectedStep(current => activeStep?.id || nextStep?.id || current);
    previousStatuses.current = Object.fromEntries(summary.steps.map(item => [item.id, item.status]));
  }, [summary.steps, activeStep, nextStep]);

  return <section aria-label="Incident story and responsible teams" className="space-y-5 min-w-0">
    {showRca && (summary.rca ? <RcaHero rca={summary.rca} nextAction={summary.nextAction} /> : <div className="border-l-4 border-blue-500 bg-blue-500/5 p-4 md:p-5"><p className="text-xs uppercase tracking-widest text-blue-700 dark:text-blue-300">Current investigation · Recorded evidence</p><h3 className="text-xl font-semibold mt-2">{summary.headline}</h3><div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4"><div><p className="text-xs text-slate-500 dark:text-zinc-400 uppercase">Responsible team</p><p className="text-sm font-semibold mt-1">{summary.owner}</p></div><div><p className="text-xs text-slate-500 dark:text-zinc-400 uppercase">Next action</p><p className="text-sm mt-1">{summary.nextAction}</p></div></div><div className={`mt-4 p-3 rounded text-sm ${summary.blocker ? "bg-amber-500/10 text-amber-900 dark:text-amber-200" : "bg-slate-100 dark:bg-zinc-900 text-slate-600 dark:text-zinc-300"}`}><strong>{summary.blocker ? "Current blocker: " : "RCA status: "}</strong>{summary.blocker || "The backend has not recorded a supported RCA for this session."}</div></div>)}
    <section aria-label="Interactive investigation workflow"><h4 className="font-semibold">Follow the workflow</h4><p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Select a step to see who owns it, what happened and which evidence supports it.</p>{workflowNotice && <p role="status" aria-live="polite" className="mt-3 flex items-center gap-2 rounded border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-sm text-blue-700 dark:text-blue-300">{activeStep ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <CheckCircle2 size={15} aria-hidden="true" />}{workflowNotice}</p>}<ol className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 mt-3">{summary.steps.map((item, index) => <li key={item.id} className="min-w-0"><button aria-pressed={step?.id === item.id} aria-controls="demo-workflow-step-detail" onClick={() => setSelectedStep(item.id)} className={`w-full h-full p-3 rounded text-left border focus:outline-none focus:ring-2 focus:ring-blue-500 ${step?.id === item.id ? "border-blue-500 bg-blue-500/5" : "border-slate-200 dark:border-zinc-800 hover:border-blue-400"}`}><span className="flex justify-between gap-2 items-center"><span className="font-mono text-xs text-slate-500 dark:text-zinc-400">{String(index + 1).padStart(2, "0")}</span><span className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded ${tone(item.status)}`}>{item.status === "ACTIVE" && <LoaderCircle size={11} className="animate-spin" aria-hidden="true" />}{item.status === "COMPLETED" && <CheckCircle2 size={11} aria-hidden="true" />}{statusLabel(item.status)}</span></span><span className="block text-sm font-semibold mt-2">{item.label}</span><span className="block text-xs text-slate-500 dark:text-zinc-400 mt-1">{item.owner}</span></button></li>)}</ol>{step && <div id="demo-workflow-step-detail" className="border border-slate-200 dark:border-zinc-800 p-4 rounded mt-3" aria-live="polite"><div className="flex flex-wrap gap-2 justify-between"><h5 className="font-semibold text-sm">{step.label}</h5><span className={`flex items-center gap-1 text-xs rounded px-2 py-1 ${tone(step.status)}`}>{step.status === "ACTIVE" && <LoaderCircle size={13} className="animate-spin" aria-hidden="true" />}{step.status === "COMPLETED" && <CheckCircle2 size={13} aria-hidden="true" />}{statusLabel(step.status)}</span></div><p className="text-xs text-blue-700 dark:text-blue-300 mt-1">Owner: {step.owner}</p><p className="text-sm mt-3 whitespace-pre-wrap">{step.description}</p>{step.evidenceIds.length ? <details className="mt-3 text-xs"><summary className="cursor-pointer text-slate-500 dark:text-zinc-400">Supporting evidence ({step.evidenceIds.length})</summary><ul className="font-mono mt-2 space-y-1 break-all">{step.evidenceIds.map(id => <li key={id}>{id}</li>)}</ul></details> : <p className="text-xs text-slate-500 dark:text-zinc-400 mt-3">No supporting evidence recorded for this step yet.</p>}</div>}</section>
    <section aria-label="Team findings"><h4 className="font-semibold">What each team found</h4><div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mt-3">{summary.teams.map(team => <article key={team.role} className={`min-w-0 border rounded p-4 ${team.status === "BLOCKED" ? "border-amber-500/40" : "border-slate-200 dark:border-zinc-800"}`}><div className="flex justify-between gap-2 items-center"><h5 className="font-semibold text-sm">{team.role}</h5><span className={`rounded text-xs px-2 py-1 ${tone(team.status)}`}>{team.status}</span></div><p className="text-sm mt-3"><span className="text-slate-500 dark:text-zinc-400">Checked: </span>{team.checked}</p><p className="text-sm mt-2 whitespace-pre-wrap">{team.finding}</p>{team.evidenceIds.length > 0 && <details className="text-xs mt-3"><summary className="cursor-pointer text-slate-500 dark:text-zinc-400">Evidence references ({team.evidenceIds.length})</summary><p className="font-mono mt-2 break-all">{team.evidenceIds.join(", ")}</p></details>}</article>)}</div></section>
  </section>;
}

function ScenarioIssueBoard({ scenarios, selectedId, onSelect }: { scenarios: Status["scenarios"]; selectedId: string; onSelect: (id: string) => void }) {
  return <div className="min-w-0"><p className="text-xs uppercase tracking-widest text-blue-600 dark:text-blue-300">Issues to correlate</p><p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Choose an incident, then create or open its isolated A2A session.</p><div className="grid gap-2 mt-3 max-h-64 overflow-y-auto pr-1">{scenarios.map(item => <button key={item.id} type="button" aria-pressed={selectedId === item.id} onClick={() => onSelect(item.id)} className={`rounded border p-3 text-left focus:outline-none focus:ring-2 focus:ring-blue-500 ${selectedId === item.id ? "border-blue-500 bg-blue-500/10" : "border-slate-200 dark:border-zinc-800 hover:border-blue-400"}`}><span className="block text-sm font-semibold">{item.name}</span><span className="mt-1 block text-xs text-slate-500 dark:text-zinc-400">{item.roles.join(" · ")}</span></button>)}</div></div>;
}

export default function A2ADemoWorkspace() {
  const [status, setStatus] = useState<Status | null>(null);
  const [scenarioId, setScenarioId] = useState("windows-dns");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [useModel, setUseModel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const currentSession = useRef("");
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    const id = currentSession.current;
    const [nextStatus, nextDetail] = await Promise.all([request<Status>("/status"), id ? request<Detail>(`/sessions/${encodeURIComponent(id)}`) : Promise.resolve(null)]);
    if (!mounted.current) return;
    setStatus(nextStatus);
    if (currentSession.current === id) setDetail(nextDetail);
    if (!id && nextStatus.sessions.length) {
      const firstSession = nextStatus.sessions[0];
      setScenarioId(firstSession.scenarioId);
      setSelected(firstSession.id);
    }
  }, []);
  useEffect(() => { mounted.current = true; void refresh().catch(e => setError(e.message)).finally(() => setLoading(false)); return () => { mounted.current = false; }; }, [refresh]);
  useEffect(() => { currentSession.current = selected; setDetail(null); if (selected) void refresh().catch(e => setError(e.message)); }, [selected, refresh]);
  const running = detail?.session.status === "RUNNING";
  useEffect(() => {
    if (!notice.startsWith("Investigation started.")) return;
    const state = detail?.session.status;
    if (state === "COMPLETED") setNotice("Investigation completed. Review the recorded evidence and replies below; completion does not establish service recovery.");
    else if (state === "FAILED" || state === "INTERRUPTED") setNotice(`Investigation ${state.toLowerCase()}. Review the session error and recorded evidence below.`);
  }, [detail?.session.status, notice]);
  useEffect(() => { const timer = window.setInterval(() => { void refresh().catch(e => setError(e.message)); }, running ? 2000 : 5000); return () => window.clearInterval(timer); }, [running, refresh]);
  async function mutate(kind: "create" | "investigate" | "fault" | "repair") {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const session = detail?.session;
      if (kind !== "create" && !session) return;
      const base = session ? `/sessions/${encodeURIComponent(session.id)}` : "";
      const path = kind === "create" ? "/sessions" : `${base}/${kind === "fault" ? "condition" : kind}`;
      const operationId = crypto.randomUUID();
      const body = kind === "create" ? { scenarioId, operationId } : kind === "investigate" ? { expectedRevision: session!.revision, useModel } : kind === "fault" ? { expectedRevision: session!.revision, condition: "FAULTED" } : { expectedRevision: session!.revision };
      const result = await request<{ session: Session }>(path, body);
      if (kind === "create") { currentSession.current = result.session.id; setSelected(result.session.id); }
      await refresh();
      setNotice(kind === "repair" ? "Demo repair applied. Investigate again to verify new observations." : kind === "fault" ? "Fault injected into this demo session. Start a new investigation to observe the changed rows." : kind === "create" ? "Isolated demo session created. Earlier session history is preserved." : "Investigation started. Evidence and replies will appear as the agents work.");
    } catch (e) { setError(e instanceof Error ? e.message : "Demo request failed."); await refresh().catch(() => {}); }
    finally { setBusy(false); }
  }
  const session = detail?.session;
  const canOperate = !!status?.canOperate && (detail?.canOperate ?? true);
  const canAct = canOperate && status?.ready && !busy && !running;
  const scenario = status?.scenarios.find(item => item.id === scenarioId);
  const scenarioSessions = status?.sessions.filter(item => item.scenarioId === scenarioId) || [];
  const selectScenario = (id: string) => {
    setScenarioId(id);
    const existing = status?.sessions.find(item => item.scenarioId === id);
    setSelected(existing?.id || "");
    setNotice("");
    setError("");
  };
  return <section aria-label="Database-backed A2A demo" className="min-w-0 max-w-full space-y-5 text-slate-900 dark:text-zinc-100 break-words">
    <header className="flex flex-wrap justify-between items-start gap-4 border-b border-slate-200 dark:border-zinc-800 pb-5"><div><p className="font-mono text-xs uppercase tracking-widest text-blue-600 dark:text-blue-300">SIMULATION · Persisted SQL records</p><h2 className="text-2xl font-semibold mt-1">A2A investigation lab</h2><p className="text-sm text-slate-500 dark:text-zinc-400 mt-2">Follow an incident from changed database rows to agent queries, cross-team replies and verified recovery.</p></div><button className={`${control} flex items-center gap-2`} onClick={() => { setError(""); void refresh().catch(e => setError(e.message)); }}><RefreshCw size={15} />Refresh</button></header>
    <p className="text-xs text-slate-500 dark:text-zinc-400">Actual SQL reads against fictional sandbox records. No production device connections. Investigation completion does not mean service recovery.</p>
    {error && <p role="alert" className="border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}{notice && <p role="status" className="text-sm text-blue-700 dark:text-blue-300">{notice}</p>}
    {loading && <p role="status" className="py-8 text-sm">Connecting to demo database…</p>}
    {!loading && (!status?.enabled || !status.ready) && <div className="border border-dashed border-slate-300 dark:border-zinc-700 p-6"><h3 className="font-semibold">Demo database unavailable</h3><p className="mt-2 text-sm text-slate-500 dark:text-zinc-400">{status?.error || "The demo database must be configured and reachable before an investigation can run."}</p></div>}
    {session?.status === "COMPLETED" && detail?.summary?.rca && <RcaHero rca={detail.summary.rca} nextAction={detail.summary.nextAction} />}
    {status?.ready && <><details className="cz-a2a-setup" open={!session}><summary>{session ? "Scenario & session setup" : "Choose a scenario and create a session"}<span>{status.scenarios.length} scenarios · {status.sessions.length} sessions</span></summary><div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)] gap-4 min-w-0"><ScenarioIssueBoard scenarios={status.scenarios} selectedId={scenarioId} onSelect={selectScenario} /><div className="min-w-0 border border-slate-200 dark:border-zinc-800 rounded p-4"><label className="grid gap-2 text-xs min-w-0"><span className="uppercase tracking-widest text-blue-600 dark:text-blue-300">Session for selected issue</span><select className={`${control} w-full min-w-0 max-w-full`} value={selected} onChange={e => { setSelected(e.target.value); setNotice(""); setError(""); }}><option value="">Create a new demo session</option>{scenarioSessions.map(item => <option key={item.id} value={item.id}>{item.title} · {time(item.createdAt)} · r{item.revision}</option>)}</select></label><button className={`${action} mt-3 w-full`} disabled={!canAct} onClick={() => void mutate("create")}>Create selected issue demo</button><p className="text-xs text-slate-500 dark:text-zinc-400 mt-3">CloudZero runs bounded deterministic checks and exchanges incident-bound evidence. Optional local-model reasoning can be enabled per investigation.</p></div></div></details><p className="text-sm text-slate-500 dark:text-zinc-400"><span className="font-semibold">Selected issue: </span>{scenario?.description} <span className="font-mono text-xs">{scenario?.roles.join(" ↔ ")}</span></p>
      <div className="flex flex-wrap gap-3 items-center text-xs text-slate-500 dark:text-zinc-400"><Database size={15} /><span>{status.database.name} · {status.database.version}</span><span>{status.database.readOnlyProxy ? "Diagnostic proxy: read-only" : "Diagnostic proxy: inspect configuration"}</span>{!canOperate && <span className="text-amber-700 dark:text-amber-300">Read-only access. Your role can inspect sessions.</span>}</div>
      {!selected && <p className="p-8 text-center border border-dashed border-slate-300 dark:border-zinc-700 text-sm">Create a demo to seed an isolated incident, maintenance record and affected resources.</p>}
      {selected && !detail && <p role="status" className="py-6 text-sm">Loading session records…</p>}
      {session && detail && <><div className="border border-slate-200 dark:border-zinc-800 bg-slate-50 dark:bg-zinc-900/40 p-4 space-y-4"><div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold">{session.title}</h3><p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">Revision {session.revision}</p><details className="cz-technical-identifiers"><summary>Technical identifiers</summary><p>Session {session.id}</p><p>Incident {session.incidentId}</p>{session.workflowId && <p>Workflow {session.workflowId}</p>}</details></div><div className="flex flex-wrap gap-2 items-start text-xs font-mono"><span className={`rounded px-2 py-1 ${session.state === "FAULTED" ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}>Service: {session.state}</span><span className="rounded bg-blue-500/10 px-2 py-1 text-blue-700 dark:text-blue-300">Investigation: {session.status}</span></div></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:flex xl:flex-wrap items-center gap-3 min-w-0"><button disabled={!canAct} className={`${action} flex gap-2 items-center`} onClick={() => void mutate("investigate")}><Play size={14} />{running ? "Investigating…" : "Investigate"}</button><label className="flex gap-2 text-xs items-center"><input type="checkbox" checked={useModel} disabled={busy || running} onChange={e => setUseModel(e.target.checked)} />Use local LLM</label><button disabled={!canAct || session.state === "FAULTED"} className={control} onClick={() => void mutate("fault")}>Inject demo fault</button><button disabled={!canAct || session.state !== "FAULTED" || session.status !== "COMPLETED"} className={control} onClick={() => void mutate("repair")}>Apply demo repair</button><a href="/?twinActivity=1" target="_blank" rel="noreferrer" className="text-xs text-blue-600 dark:text-blue-300 flex gap-1 items-center"><ExternalLink size={13} />Activity & reviews</a></div>
        <p className="text-xs text-slate-500 dark:text-zinc-400">{running ? "Agents are reading records and exchanging findings. Local model replies may take several minutes; progress appears below as evidence arrives." : "Repair requires a completed investigation of this faulted revision. Repair changes only sandbox rows; investigate again to verify recovery."}</p>{session.lastError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{session.lastError}</p>}</div>
        <div className="space-y-5 min-w-0">{detail.summary ? <InvestigationStory summary={detail.summary} /> : <p className="text-sm text-slate-500 dark:text-zinc-400">The readable investigation summary is not available yet. Recorded evidence remains available below.</p>}<details className="min-w-0 border border-slate-200 dark:border-zinc-800 p-4 rounded"><summary className="font-semibold text-sm cursor-pointer">Current resource records</summary><section className="min-w-0 space-y-3 mt-3">{detail.resources.map(resource => <article key={resource.id} className="border border-slate-200 dark:border-zinc-800 rounded p-3"><div className="flex flex-wrap gap-2 justify-between"><h4 className="text-sm font-semibold">{resource.name}</h4><span className="font-mono text-xs text-blue-600 dark:text-blue-300">{resource.role}</span></div><p className="text-xs text-slate-500 dark:text-zinc-400 my-2">Updated {time(resource.updatedAt)}</p><Json data={resource.state} /></article>)}</section></details><details className="min-w-0 border border-slate-200 dark:border-zinc-800 p-4 rounded"><summary className="font-semibold text-sm cursor-pointer">Technical A2A requests & replies ({detail.exchanges.length})</summary><div className="mt-4"><Events events={detail.exchanges} /></div></details></div>
        <section className="border-t border-slate-200 dark:border-zinc-800 pt-4"><h3 className="font-semibold">Database evidence queries <span className="text-xs font-mono text-slate-500 dark:text-zinc-400">({detail.queries.length})</span></h3><p className="text-xs text-slate-500 dark:text-zinc-400 mt-1">Compare observed row revisions before and after a fault or repair.</p>{!detail.queries.length && <p className="text-sm text-slate-500 dark:text-zinc-400 py-4">No diagnostic queries recorded yet.</p>}<div className="space-y-2 mt-3">{detail.queries.map(query => <details key={query.id} className="border border-slate-200 dark:border-zinc-800 p-3 rounded"><summary className="cursor-pointer text-xs"><span className="font-mono text-blue-600 dark:text-blue-300">{query.templateId}</span> · {query.persona} · revision {query.revision} · {time(query.observedAt)}</summary><p className="font-mono text-xs text-slate-500 dark:text-zinc-400 my-2">Device: {query.deviceId} · Evidence: {query.id}</p><Json data={query.output} /></details>)}</div></section>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><details className="min-w-0 border border-slate-200 dark:border-zinc-800 rounded p-3"><summary className="cursor-pointer font-semibold text-sm">Incident & maintenance rows ({detail.incidents.length + detail.changes.length})</summary><div className="space-y-3 mt-3">{detail.incidents.map(item => <article key={item.id}><p className="font-mono text-xs mb-1">{item.id} · {item.role}</p><Json data={item.record} /></article>)}{detail.changes.map(item => <article key={item.id}><p className="font-mono text-xs mb-1">{item.id}</p><Json data={item.record} /></article>)}</div></details><details className="min-w-0 border border-slate-200 dark:border-zinc-800 rounded p-3"><summary className="cursor-pointer font-semibold text-sm">Business order rows ({detail.orders.length})</summary>{detail.orders.length ? <div className="overflow-auto"><table className="w-full text-xs mt-3 text-left"><thead><tr><th className="p-2">Order</th><th className="p-2">Status</th><th className="p-2">Amount</th></tr></thead><tbody>{detail.orders.map(order => <tr key={order.id} className="border-t border-slate-200 dark:border-zinc-800"><td className="p-2 font-mono">{order.id}</td><td className="p-2">{order.status}</td><td className="p-2">{order.amount}</td></tr>)}</tbody></table></div> : <p className="text-sm mt-3 text-slate-500 dark:text-zinc-400">No orders in this scenario.</p>}</details></div>
        <details className="min-w-0 border border-slate-200 dark:border-zinc-800 rounded p-3"><summary className="cursor-pointer font-semibold text-sm">Full session history ({detail.events.length} events)</summary><div className="mt-4"><Events events={detail.events} /></div></details><details className="min-w-0 border border-slate-200 dark:border-zinc-800 rounded p-3"><summary className="cursor-pointer font-semibold text-sm">Incident work notes ({detail.workNotes.length})</summary><ol className="space-y-3 mt-3">{detail.workNotes.map(note => <li key={note.id}><time className="text-xs text-slate-500 dark:text-zinc-400">{time(note.createdAt)}</time><p className="text-sm mt-1 whitespace-pre-wrap">{note.text}</p></li>)}</ol></details>
      </>}
    </>}
  </section>;
}
