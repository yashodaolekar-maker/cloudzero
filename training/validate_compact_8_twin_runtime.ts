/** Post-process raw compact benchmark artifacts through the production guardrail.
 * Raw records are read-only: this only emits a separate runtime result. */
import fs from "node:fs";
import path from "node:path";
import { validateEvidenceState } from "../src/server/evidence-state-guardrail.ts";

const root = process.cwd();
const out = path.join(root, ".data", "training", "evaluations", "compact-8-twin-behavior-v1");
const twins = ["network", "windows", "linux", "database", "middleware", "cloudops", "devops", "cyber"];
const read = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));
const cases = new Map<string, any>();
for (const dir of fs.readdirSync(path.join(root, "training", "benchmarks", "cases"))) {
  const file = path.join(root, "training", "benchmarks", "cases", dir, "cases.jsonl");
  if (fs.existsSync(file)) for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) if (line.trim()) { const c = JSON.parse(line); cases.set(c.id, c); }
}
const summary: Record<string, any> = {};
for (const twin of twins) {
  const raw = read(path.join(out, `${twin}-results.json`));
  const rows = raw.results.map((row: any) => {
    const c = cases.get(row.caseId);
    const response = row.inspectableResponse || {};
    const modelState = row.behavior?.modelProposedState || "";
    const evidence = [...(c.observedEvidence || []), ...(c.distractorEvidence || [])].map((summary: string, index: number) => ({ id: `${c.id}-${index}`, source: "FROZEN_BENCHMARK", summary }));
    const decision = validateEvidenceState({ evidence, modelProposedState: modelState, modelRemediation: String(response.remediation || ""), modelEscalateTo: Array.isArray(response.escalateTo) ? response.escalateTo : [], requiredParticipants: c.crossTwinDependencies || [] });
    return { caseId: c.id, modelProposedState: decision.modelProposedState, validatedEvidenceState: decision.validatedEvidenceState, modelProposedRemediation: String(response.remediation || ""), validatedRemediationDisposition: decision.remediation.disposition, modelEscalation: response.escalateTo || [], derivedParticipants: decision.requestedParticipants, disagreement: decision.disagreement || null, initialSignal: (c.observedEvidence || []).every((x: string) => x === "INITIAL_SIGNAL"), guardrailFailure: null };
  });
  summary[twin] = { unsupportedStatesCaught: rows.filter((r: any) => Boolean(r.disagreement)).length, unsafeRemediationBlocked: rows.filter((r: any) => r.validatedRemediationDisposition === "BLOCKED_INSUFFICIENT_EVIDENCE").length, missingParticipantsDerived: rows.filter((r: any) => r.derivedParticipants.length > r.modelEscalation.length).length, guardrailFailures: rows.filter((r: any) => r.guardrailFailure).length, results: rows };
}
fs.writeFileSync(path.join(out, "runtime-guardrail-summary.json"), JSON.stringify(summary, null, 2));
const raw = read(path.join(out, "raw-behavior-summary.json"));
const deltas = read(path.join(out, "adapter-vs-base.json"));
const status = Object.values(raw).every((x: any) => x.gate === "RAW_BEHAVIOR_ACCEPTABLE_FOR_EXPERIMENT") && Object.values(summary).every((x: any) => x.guardrailFailures === 0) ? "READY_FOR_INTEGRATION_EXPERIMENTS" : "MODEL_BEHAVIOR_REVIEW_REQUIRED";
const lines = ["# COMPACT 8-Twin Behavioral Benchmark V1", "", `Program status: \`${status}\``, "", "Development-only, frozen benchmark; this is not production approval.", "", "## Raw model behavior", "", "| Twin | Cases | Completed | Schema valid | Correct abstention | Unsupported RCA | Premature RCA | Unsafe remediation | Cross-Twin behavior | Gate |", "|---|---:|---:|---:|---:|---:|---:|---:|---:|---|"];
for (const [t, x] of Object.entries(raw) as any[]) lines.push(`| ${t} | ${x.cases} | ${x.completed} | ${x.schemaValid} | ${x.correctAbstention} | ${x.unsupportedRCA} | ${x.prematureRCA} | ${x.unsafeRemediation} | ${x.crossTwinBehavior} | ${x.gate} |`);
lines.push("", "## Base delta", "", "| Twin | Better | Same | Regression | Inconclusive |", "|---|---:|---:|---:|---:|");
for (const t of twins) { const d = deltas.filter((x: any) => x.twin === t).map((x: any) => x.delta); lines.push(`| ${t} | ${d.filter((x: string) => x === "BETTER_BEHAVIOR").length} | ${d.filter((x: string) => x === "SAME_BEHAVIOR").length} | ${d.filter((x: string) => x === "REGRESSION").length} | ${d.filter((x: string) => x === "INCONCLUSIVE").length} |`); }
lines.push("", "## Runtime guardrail", "", "| Twin | Unsupported states caught | Unsafe remediation blocked | Missing participants derived | Guardrail failures |", "|---|---:|---:|---:|---:|");
for (const [t, x] of Object.entries(summary) as any[]) lines.push(`| ${t} | ${x.unsupportedStatesCaught} | ${x.unsafeRemediationBlocked} | ${x.missingParticipantsDerived} | ${x.guardrailFailures} |`);
lines.push("", "Raw model output was not rewritten or credited by the guardrail. Cases without objective supporting/confirming evidence are marked `SCORER_UNVERIFIED` in raw records.");
fs.writeFileSync(path.join(out, "report.md"), lines.join("\n") + "\n");
console.log(JSON.stringify({ status, twins: Object.fromEntries(Object.entries(summary).map(([t, x]: any) => [t, { caught: x.unsupportedStatesCaught, blocked: x.unsafeRemediationBlocked, failures: x.guardrailFailures }])) }, null, 2));
