import { useState } from "react";
import {
  Code,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Lock,
  RefreshCw,
  Send,
} from "lucide-react";

export default function ApiPlaygroundView() {
  const [ephemeralCredential, setEphemeralCredential] = useState("");
  const [showCredential, setShowCredential] = useState(false);
  const [targetService, setTargetService] = useState("ServiceNow");
  const [reviewSummary, setReviewSummary] = useState("Review critical incident signal");
  const [payloadText, setPayloadText] = useState(
    JSON.stringify({ incident_ref: "INC-2026-9041", severity: "CRITICAL", zone: "us-east-1" }, null, 2),
  );
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseBody, setResponseBody] = useState("");
  const [loading, setLoading] = useState(false);

  const submitForReview = async () => {
    if (!ephemeralCredential) return;
    setLoading(true);
    setResponseStatus(null);
    setResponseBody("");

    try {
      let parsedPayload: unknown;
      try {
        parsedPayload = JSON.parse(payloadText) as unknown;
      } catch {
        setResponseStatus(400);
        setResponseBody(JSON.stringify({ error: "Bad Request: The payload is not valid JSON." }, null, 2));
        return;
      }

      const response = await fetch("/api/v1/workflows/trigger", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ephemeralCredential}`,
        },
        body: JSON.stringify({
          targetService,
          actionCommand: reviewSummary,
          payload: parsedPayload,
        }),
      });
      const data = await response.json();
      setResponseStatus(response.status);
      setResponseBody(JSON.stringify(data, null, 2));
    } catch (error: unknown) {
      setResponseStatus(500);
      setResponseBody(JSON.stringify({
        error: "Failed to communicate with the API server.",
        details: error instanceof Error ? error.message : "Unknown network error",
      }, null, 2));
    } finally {
      setLoading(false);
    }
  };

  const successfulResponse = responseStatus !== null && responseStatus >= 200 && responseStatus < 300;

  return (
    <main className="h-screen flex-1 overflow-y-auto bg-slate-100 pt-16 text-slate-900 transition-colors dark:bg-[#070b14] dark:text-slate-100 md:pt-0">
      <div className="mx-auto max-w-6xl p-4 sm:p-6 xl:p-8">
        <header className="mb-6">
          <p className="flex items-center gap-2 text-[10px] font-semibold text-blue-700 dark:text-blue-300"><KeyRound className="h-4 w-4" /> Developer APIs</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Webhook ingestion for review</h1>
          <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600 dark:text-slate-400">Submit a third-party event for validation and operator review. Ingestion does not authorize remediation or autonomous execution.</p>
        </header>

        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)]">
          <aside className="min-w-0 space-y-6">
            <section aria-labelledby="gateway-access-heading" className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <h2 id="gateway-access-heading" className="text-sm font-bold">Gateway access</h2>
              <div className="mt-4">
                <p className="text-[10px] font-semibold text-slate-500">Webhook endpoint</p>
                <div className="mt-1.5 flex min-h-10 items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 font-mono text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"><span className="truncate">/api/v1/workflows/trigger</span><Globe className="h-4 w-4 shrink-0 text-blue-600" /></div>
              </div>

              <div className="mt-4">
                <label htmlFor="ephemeral-webhook-password" className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">Ephemeral test password</label>
                <div className="relative mt-1.5">
                  <input
                    id="ephemeral-webhook-password"
                    type={showCredential ? "text" : "password"}
                    value={ephemeralCredential}
                    onChange={(event) => setEphemeralCredential(event.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="credential-help"
                    placeholder="Enter a credential for this request"
                    className="min-h-11 w-full rounded-md border border-slate-300 bg-white py-2 pl-3 pr-11 font-mono text-xs text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                  <button type="button" onClick={() => setShowCredential((shown) => !shown)} aria-label={showCredential ? "Hide test password" : "Show test password"} className="absolute inset-y-0 right-0 grid w-11 place-items-center text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500">
                    {showCredential ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p id="credential-help" className="mt-2 text-[10px] leading-4 text-slate-500">Held only in component memory for this test request and never persisted. Production credentials are resolved by the server-side secret provider.</p>
              </div>
            </section>

            <section aria-labelledby="curl-heading" className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
              <h2 id="curl-heading" className="flex items-center gap-2 text-sm font-bold"><Code className="h-4 w-4 text-blue-600" /> cURL template</h2>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">Set the environment variable from your approved secret provider before running this example.</p>
              <pre className="mt-4 max-w-full overflow-x-auto rounded-md border border-slate-800 bg-slate-950 p-4 font-mono text-[10px] leading-5 text-slate-300">
{`curl -X POST /api/v1/workflows/trigger \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $WEBHOOK_BEARER_TOKEN" \\
  -d '{
    "targetService": "ServiceNow",
    "actionCommand": "Review critical incident signal",
    "payload": {
      "incident_ref": "INC-2026-9041",
      "severity": "CRITICAL"
    }
  }'`}
              </pre>
            </section>
          </aside>

          <section aria-labelledby="sandbox-heading" className="min-w-0 rounded-lg border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-6">
            <div className="border-b border-slate-200 pb-4 dark:border-slate-800"><h2 id="sandbox-heading" className="text-sm font-bold">Review-ingestion sandbox</h2><p className="mt-1 text-[10px] leading-4 text-slate-500">The existing wire contract is preserved; the command field is treated as a review-request summary.</p></div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">Source platform
                <input type="text" value={targetService} onChange={(event) => setTargetService(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>
              <label className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">Review request summary
                <input type="text" value={reviewSummary} onChange={(event) => setReviewSummary(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-700 dark:bg-slate-950" />
              </label>
            </div>

            <label className="mt-4 block text-[10px] font-semibold text-slate-600 dark:text-slate-400">JSON event payload
              <textarea value={payloadText} onChange={(event) => setPayloadText(event.target.value)} spellCheck={false} className="mt-1.5 h-36 w-full resize-y rounded-md border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" />
            </label>

            <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-[10px] leading-4 text-slate-500"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />Accepted events enter validation and human review. They do not grant execution authority.</p>
              <button type="button" disabled={loading || !ephemeralCredential || !reviewSummary.trim()} onClick={submitForReview} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-xs font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
                {loading ? <><RefreshCw className="h-4 w-4 animate-spin" />Submitting event</> : <><Send className="h-4 w-4" />Submit event for review</>}
              </button>
            </div>

            <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-800">
              <div className="flex items-center justify-between gap-3"><h3 className="text-xs font-semibold">Gateway response</h3>{responseStatus !== null && <span className={`rounded border px-2 py-1 text-[10px] font-semibold ${successfulResponse ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300" : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"}`}>HTTP {responseStatus}</span>}</div>
              {responseBody ? <pre className="mt-3 h-48 max-w-full overflow-auto rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-[11px] leading-5 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-blue-300">{responseBody}</pre> : <div className="mt-3 grid h-48 place-items-center rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 text-center font-mono text-[10px] text-slate-500 dark:border-slate-700 dark:bg-slate-950">No event submitted in this session.</div>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
