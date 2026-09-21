import React, { useEffect, useState } from "react";

type Exchange = { id: string; type: string; payload: Record<string, unknown> };
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
  const matches = [...assessment.slice(prefix).matchAll(/"role"\s*:\s*"([^"\\]+)"[\s\S]*?"finding"\s*:\s*"((?:\\.|[^"\\])*)"/g)];
  return matches.length ? matches.map(match => `${match[1]}: ${match[2].replace(/\\"/g, '"')}`).join(" ") : "Recorded sandbox observations require review.";
}
function Verdict({ payload }: { payload: Record<string, unknown> }) {
  const tone = verdictFor(payload);
  const colors = { RED: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300", YELLOW: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300", GREEN: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" };
  const checks = Array.isArray(payload.validationChecks) ? payload.validationChecks.filter(item => item && typeof item === "object") as Record<string, unknown>[] : [];
  return <div className={`mt-2 rounded border p-3 ${colors[tone]}`}><p className="font-bold">FINAL VERDICT: {tone}</p><p className="mt-1 whitespace-pre-wrap">{readableAssessment(payload)}</p>{checks.length > 0 && <div className="mt-3 space-y-2"><p className="text-xs font-bold uppercase tracking-wide">Validation evidence</p>{checks.map((check, index) => <article key={`${String(check.evidenceId)}-${index}`} className="rounded border border-current/20 bg-white/50 p-2 dark:bg-black/20"><p className="text-xs font-semibold">{String(check.objective || check.templateId || "Read-only validation")}</p><code className="mt-1 block whitespace-pre-wrap break-all rounded bg-slate-950 p-2 text-[11px] text-emerald-300">{String(check.command || "Command unavailable")}</code><p className="mt-1 text-xs"><strong>{String(check.status || "UNKNOWN")}</strong> · {String(check.observedAt || "time unavailable")} · evidence {String(check.evidenceId || "unavailable")}</p><pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-xs">{String(check.output || "No output recorded")}</pre></article>)}</div>}{typeof payload.nextCheck === "string" && <p className="mt-2"><strong>Immediate action:</strong> {payload.nextCheck}</p>}</div>;
}
export function AgentCollaborationPanel({ incidentId, canInvestigate }: { key?: string; incidentId: string; canInvestigate: boolean }) {
  const [events, setEvents] = useState<Exchange[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const base = `/api/engineering/incidents/${encodeURIComponent(incidentId)}`;
  async function request(path: string, body?: unknown) {
    const response = await fetch(base + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || "Agent exchange could not be loaded.");
    return data;
  }
  async function refresh() {
    const data = await request("/collaboration");
    setEvents(Array.isArray(data.events) ? data.events.filter((event: Exchange) => ["AgentInvestigationRequested", "AgentValidationReplied", "AgentOwnerAssessmentCompleted", "AgentCollaborationWorkNote"].includes(event.type)).slice(-20) : []);
  }
  useEffect(() => {
    let active = true;
    request("/collaboration").then(data => {
      if (active) setEvents(Array.isArray(data.events) ? data.events.filter((event: Exchange) => ["AgentInvestigationRequested", "AgentValidationReplied", "AgentOwnerAssessmentCompleted", "AgentCollaborationWorkNote"].includes(event.type)).slice(-20) : []);
    }).catch(error => { if (active) setError(String(error.message)); });
    return () => { active = false; };
  }, [incidentId]);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => { refresh().catch(() => {}); }, 3000);
    return () => window.clearInterval(timer);
  }, [busy, incidentId]);
  async function investigate() {
    setBusy(true); setError("");
    try {
      const prepared = await request("/prepare", {});
      await request("/collaborate", { workflowId: prepared.workflow.id });
      await refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Investigation failed."); }
    finally { setBusy(false); }
  }
  const value = (data: Record<string, unknown>, key: string) => typeof data[key] === "string" ? data[key] as string : "";
  return <section className="rounded-lg border border-slate-200 dark:border-zinc-800 p-4 my-4" aria-label="Agent collaboration">
    <div className="flex flex-wrap gap-3 items-center justify-between">
      <h3 className="font-semibold text-sm">Agent-to-agent investigation</h3>
      <div className="flex gap-3 text-xs">
        <button onClick={() => { setError(""); refresh().catch(error => setError(error.message)); }}>Refresh exchanges</button>
        {canInvestigate && <button disabled={busy} onClick={investigate} className="rounded bg-indigo-600 px-3 py-2 text-white disabled:opacity-50">{busy ? "Agents investigating…" : "Ask twins to investigate"}</button>}
      </div>
    </div>
    <p className="text-xs text-slate-500 mt-2">Requests, validation replies and the incident owner's assessment. Diagnostics do not authorize remediation.</p>
    {error && <p role="alert" className="text-sm text-red-600 mt-2">{error}</p>}
    {!events.length && <p className="text-sm mt-3">No agent conversations recorded for this incident yet.</p>}
    <ol className="space-y-3 mt-3 max-h-96 overflow-auto" aria-live="polite">
      {events.map(event => <li key={event.id} className="text-sm rounded bg-slate-50 dark:bg-zinc-900 p-3">
        <p className="font-semibold">{value(event.payload, "sender")} → {value(event.payload, "recipient")}</p>
        <p className="text-xs text-slate-500">{value(event.payload, "kind")} {value(event.payload, "validationStatus")}</p>
        {event.type === "AgentCollaborationWorkNote" && typeof event.payload.note === "string" ? <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{event.payload.note}</pre> : <Verdict payload={event.payload} />}
      </li>)}
    </ol>
  </section>;
}
