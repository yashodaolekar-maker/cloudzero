# Demo gap review — 12 September 2026

The project has substantial infrastructure, but it does not yet provide one reliable incident-to-outcome story with defensible ROI. Container health and successful compilation do not establish demo readiness.

## Verified findings

| Area | Evidence | Consequence |
| --- | --- | --- |
| Incident controls | `compose.yaml` enables production hardening. The API boundary returns HTTP 410 for the legacy incident trigger, note, clock, takeover and resolve routes. Several browser handlers previously ignored non-200 responses. | Visible controls can appear to do nothing. |
| Takeover implementation | The original handler changed assignment without calling diagnostics. Clock pickup skips incidents already assigned to the twin. | A ticket could remain assigned without investigation. |
| Database demonstration | The existing integration script passed fresh DNS and database-pool sessions: investigation, sandbox repair, fresh recovery observations, work notes, stale-revision rejection and restricted proxy writes. | This is the strongest currently verified demonstration path. It is synthetic, database-backed evidence. |
| Compact model | Running status reported Qwen3 4B, GGUF Q4_K_M, installed and reachable. Its last recorded run was a failed fallback attempt on 10 September. | Installation is verified; successful current inference and useful answers still need a fresh evaluation. |
| Model usage | The client previously discarded Ollama token counts and timing. | Historical token-cost savings cannot be reconstructed reliably from existing task durations alone. |
| Accuracy | SQL scenario summaries are deterministic; the demo defaults to model generation disabled. | Passing deterministic scenarios is not proof of distilled-model accuracy or effectiveness. |
| Resolution | The legacy resolve handler asserted successful verification without checking evidence. The database repair workflow deliberately leaves ticket closure separate. | Do not re-enable legacy routes as a shortcut. Closure needs current recovery evidence and an explicit outcome. |

## Changes made in this review

- Added a simulation-only, operator-authorized takeover endpoint under `/api/engineering/incidents/:incidentId/takeover`. It prepares the evidence workflow, runs the existing collaboration service, and returns investigation results. Existing hardening stays enabled.
- Connected the sidecar takeover control to this endpoint. It shows pending activity and supports retry rather than permanently disabling a ticket already assigned to a twin.
- Made failed incident actions visible instead of silently ignoring API failures. Other legacy controls remain blocked by the server; showing their error is not a replacement workflow.
- Recorded per-model-attempt wall time and provider-reported input/output tokens through the existing invocation ledger callback. Rejected generated output retains its usage. Unknown counts remain null, including unavailable/timeout responses; these are not zero-cost attempts.
- Added regression coverage for actual takeover evidence/work notes and primary/fallback usage accounting.

Deployment follow-up: rebuilt and recreated only `cloudzero-digital-twin` on 12 September. HTTP readiness returned 200, the served browser bundle includes the updated investigation controls, the new takeover route responds correctly, and the demo database reports ready. Existing persistent volumes were retained.

## ROI contract for the demo

Show two separate comparisons, each with its assumptions visible. Choose one currency and one reporting period consistently.

**Engineering capacity released**

`hours released = comparable incident count × (manual active minutes − assisted active minutes) / 60`

`capacity value = hours released × fully loaded hourly rate`

Manual and assisted times must include comparable work: investigation, coordination, review, repair and verification. Task wall time is not engineer active time. Count each incident once; summing overlapping team tasks overstates elapsed-time savings. Negative savings must remain visible. Capacity value becomes realized financial savings only when an actual cost is avoided or capacity is productively redeployed.

**Inference comparison**

`hosted comparison cost = input tokens / 1,000,000 × assumed input rate + output tokens / 1,000,000 × assumed output rate`

`local allocated cost = compute + electricity + hardware amortization + serving/operations allocation`

`inference cost difference = hosted comparison cost − local allocated cost`

Specify the comparator model and dated rates before using price figures. A same-token estimate is a pricing scenario, not a measured hosted benchmark: tokenizers, response length, retries and answer quality differ. Include primary failures and fallback work in the local cost. If any attempt has missing usage, label the measured total incomplete. Local inference does not mean free inference.

For project ROI, compare against a defined manual or hosted-assisted baseline and subtract all incremental implementation and operating costs. Do not add the same labor or infrastructure cost to both savings categories. Display ROI as unavailable when the investment denominator is zero or unconfigured.

## Remaining demo-critical work

1. Bring creation, investigation, evidence, review, repair, verification and closure into one working incident experience. Reuse the database demo workflow and current-revision checks; replace the blocked legacy controls.
2. Run a fresh primary-model investigation and inspect the answers. Compare the same case with model generation off and on. Show which output came from SQL rules, primary generation, fallback or human review.
3. Add an ROI view using agreed baseline effort, review effort, volume, currency, labor rate, hosting rates and local running costs. Display measured run data separately from projections.
4. Add evidence-bound closure and a concise incident outcome containing the detected cause, responsible team, action, verification result, model usage and reviewer verdict.
5. Rebuild the local application and rehearse the exact browser sequence. Keep a completed, clearly labelled recorded run available if generation is slow or unavailable.

No new executive/demo-audience branding was added to the app. Existing seeded content includes the user's prohibited acronym; cleaning displayed legacy content remains outstanding and should not rewrite immutable event history.

## Verification

- TypeScript checking passed after the changes.
- Nine focused model and HTTP collaboration tests passed, including takeover with hardening enabled.
- Existing live-local database integration checks passed for DNS and connection-pool cases with generation disabled. They created two retained sandbox sessions.
- Browser inspection confirmed the running overview is accessible. The changed UI has not been browser-validated against a rebuilt container.
