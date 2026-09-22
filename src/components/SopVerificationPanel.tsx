import { useEffect, useState } from "react";
import { AlertTriangle, BookOpenCheck, CheckCircle2, ChevronDown, FileSearch, Loader2, LockKeyhole } from "lucide-react";

export interface SopCitation {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  score: number;
}

export interface SopVerificationPlan {
  groundingStatus: "GROUNDED" | "ABSTAINED";
  severity: string;
  verificationChecks: Array<{ id: string; check: string; status: "PENDING" }>;
  citations: SopCitation[];
  actionBlocked: boolean;
  limitations: string[];
  modelAssessment: string;
  modelStatus: "GENERATED" | "FALLBACK" | "NOT_USED";
}

async function requestPlan(incidentId: string, signal?: AbortSignal): Promise<SopVerificationPlan> {
  const response = await fetch("/api/knowledge/verification-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ incidentId }),
    signal,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Verification planner returned HTTP ${response.status}.`);
  return data;
}

export function VerificationPlanResult({ plan }: { plan: SopVerificationPlan }) {
  const grounded = plan.groundingStatus === "GROUNDED";
  return <div className="space-y-4" aria-live="polite">
    <div className={`rounded-lg border p-3 ${grounded ? "border-teal-200 bg-teal-50 dark:border-teal-900 dark:bg-teal-950/30" : "border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {grounded ? <CheckCircle2 className="h-4 w-4 text-teal-700 dark:text-teal-300" /> : <AlertTriangle className="h-4 w-4 text-amber-700 dark:text-amber-300" />}
        <span className="text-xs font-bold">{grounded ? "Grounded in approved SOP" : "Abstained — no approved SOP match"}</span>
        <span className="ml-auto rounded border border-current/20 px-2 py-0.5 font-mono text-[9px] font-bold uppercase">Model {plan.modelStatus.replaceAll("_", " ")}</span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">{plan.modelAssessment}</p>
    </div>

    {plan.verificationChecks.length > 0 && <section aria-labelledby="pending-checks-heading">
      <div className="flex items-center justify-between gap-3"><h3 id="pending-checks-heading" className="text-xs font-bold uppercase tracking-wider text-slate-500">Pending verification checks</h3><span className="font-mono text-[10px] text-slate-500">{plan.verificationChecks.length} recommended</span></div>
      <ol className="mt-2 space-y-2">{plan.verificationChecks.map((item, index) => <li key={item.id} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/50"><span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-blue-600 text-[10px] font-bold text-white">{index + 1}</span><div className="min-w-0"><p className="text-xs leading-5 text-slate-700 dark:text-slate-200">{item.check}</p><p className="mt-1 font-mono text-[9px] font-bold text-amber-700 dark:text-amber-300">PENDING · NOT EXECUTED</p></div></li>)}</ol>
    </section>}

    {plan.citations.length > 0 && <details className="group rounded-lg border border-slate-200 dark:border-slate-800">
      <summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-xs font-semibold"><FileSearch className="h-4 w-4 text-blue-600 dark:text-blue-300" />Evidence provenance <span className="text-slate-500">({plan.citations.length})</span><ChevronDown className="ml-auto h-4 w-4 transition-transform group-open:rotate-180" /></summary>
      <div className="space-y-2 border-t border-slate-200 p-3 dark:border-slate-800">{plan.citations.map(citation => <article key={`${citation.documentId}-${citation.chunkId}`} className="rounded-md bg-slate-50 p-2.5 dark:bg-slate-900"><p className="text-xs font-semibold">{citation.documentTitle}</p><p className="mt-1 break-all font-mono text-[9px] text-slate-500">p. {citation.pageStart}{citation.pageEnd !== citation.pageStart ? `–${citation.pageEnd}` : ""} · {citation.chunkId} · relevance {citation.score}</p></article>)}</div>
    </details>}

    <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/50"><LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" /><div><p className="text-xs font-semibold">Read-only recommendation boundary</p><p className="mt-1 text-[11px] leading-4 text-slate-500">No check has run and no action has been authorized. Current-state evidence and required approvals remain mandatory.</p>{plan.limitations.map((item, index) => <p key={index} className="mt-1 text-[10px] text-slate-500">{item}</p>)}</div></div>
  </div>;
}

export default function SopVerificationPanel({ incidentId, compact = false }: { incidentId: string; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  const [plan, setPlan] = useState<SopVerificationPlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setPlan(null); setError(null); }, [incidentId]);
  const generate = async () => {
    setLoading(true); setError(null);
    try { setPlan(await requestPlan(incidentId)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Verification plan unavailable."); }
    finally { setLoading(false); }
  };

  if (compact) return <section className="rounded-xl border border-blue-200 bg-white shadow-sm dark:border-blue-950 dark:bg-slate-900">
    <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open} className="flex w-full items-center gap-3 p-4 text-left"><BookOpenCheck className="h-4 w-4 text-blue-600 dark:text-blue-300" /><div className="min-w-0 flex-1"><h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">SOP verification</h2><p className="mt-0.5 text-[10px] text-slate-500">Retrieve approved checks for this incident.</p></div><ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>
    {open && <div className="border-t border-slate-200 p-4 dark:border-slate-800">{!plan && <button type="button" disabled={loading} onClick={generate} className="flex min-h-10 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white disabled:opacity-60">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}{loading ? "Retrieving approved SOP…" : "Generate verification plan"}</button>}{error && <p role="alert" className="mt-2 text-xs text-rose-600">{error}</p>}{plan && <VerificationPlanResult plan={plan} />}</div>}
  </section>;

  return <>{!plan && <button type="button" disabled={loading || !incidentId} onClick={generate} className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />}{loading ? "Retrieving and prioritizing…" : "Generate grounded plan"}</button>}{error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</p>}{plan && <VerificationPlanResult plan={plan} />}</>;
}
