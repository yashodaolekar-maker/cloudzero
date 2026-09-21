/** Deterministic evidence-state policy. Model output is advisory, never authority. */
export type EvidenceState = "SUSPECTED" | "SUPPORTED" | "CONFIRMED" | "ELIMINATED" | "INSUFFICIENT_EVIDENCE";
export type ProposedState = EvidenceState | "ESTABLISHED" | "UNCONFIRMED" | "";
export interface EvidenceStateInput {
  evidence: Array<{ id?: string; source?: string; status?: string; summary?: string; payload?: Record<string, unknown> }>;
  modelProposedState?: string;
  modelRemediation?: string;
  modelEscalateTo?: string[];
  requiredParticipants?: string[];
}
export interface EvidenceStateDecision {
  modelProposedState: ProposedState;
  validatedEvidenceState: EvidenceState;
  overallRcaState: EvidenceState;
  remediation: { disposition: "ALLOWED_DIAGNOSTIC" | "BLOCKED_INSUFFICIENT_EVIDENCE" | "REQUIRES_EXISTING_HITL"; reason: string };
  requestedParticipants: string[];
  disagreement?: string;
}

const normalize = (value: unknown) => String(value || "").trim().toUpperCase().replace(/[ -]+/g, "_");
const state = (value: unknown): ProposedState => {
  const candidate = normalize(value);
  return ["SUSPECTED","SUPPORTED","CONFIRMED","ELIMINATED","INSUFFICIENT_EVIDENCE","ESTABLISHED","UNCONFIRMED"].includes(candidate) ? candidate as ProposedState : "";
};
const text = (item: EvidenceStateInput["evidence"][number]) => `${item.summary || ""} ${item.status || ""} ${JSON.stringify(item.payload || {})}`.toUpperCase();
const mutation = (value: string) => /\b(RECONFIGURE|CONFIGURE|CHANGE|RESTART|DELETE|REMOVE|DISABLE|ENABLE|APPLY|PATCH|ROTATE|ASSIGN|UPDATE)\b/.test(value.toUpperCase());
const explicitHypothesisStates = (evidence: EvidenceStateInput["evidence"]): EvidenceState[] => evidence.flatMap(item => {
  const payload = item.payload || {};
  const observations = payload.observations && typeof payload.observations === "object" ? payload.observations as Record<string, unknown> : payload;
  return Object.entries(observations)
    .filter(([key]) => /hypothesis$/i.test(key))
    .map(([, value]) => state(value))
    .filter((value): value is EvidenceState => ["SUSPECTED", "SUPPORTED", "CONFIRMED", "ELIMINATED", "INSUFFICIENT_EVIDENCE"].includes(value));
});

export function validateEvidenceState(input: EvidenceStateInput): EvidenceStateDecision {
  const proposed = state(input.modelProposedState);
  const evidence = input.evidence || [];
  const records = evidence.map(item => text(item));
  const hypothesisStates = explicitHypothesisStates(evidence);
  const initialOnly = !records.length || records.every(item => /INITIAL[_ ]SIGNAL/.test(item));
  const contradictory = records.some(item => /CONTRADICT|CONFLICT|MISMATCHED[_ ]OBSERVATION/.test(item));
  const eliminated = records.some(item => /ELIMINAT(?:ED|ING)|DISPROV(?:ED|ES)/.test(item));
  const supporting = records.filter(item => !/INITIAL[_ ]SIGNAL|SIMULATED|NEEDS_EVIDENCE/.test(item));
  const independentSources = new Set(evidence.filter((_, index) => supporting.includes(records[index])).map(item => String(item.payload?.sourceFamily || item.payload?.connector || item.source || "")).filter(Boolean));
  let validated: EvidenceState;
  if (hypothesisStates.includes("CONFIRMED")) validated = "CONFIRMED";
  else if (hypothesisStates.includes("SUPPORTED")) validated = "SUPPORTED";
  else if (initialOnly) validated = "SUSPECTED";
  else if (contradictory) validated = "SUSPECTED";
  else if (hypothesisStates.length && hypothesisStates.every(item => item === "ELIMINATED")) validated = "ELIMINATED";
  else if (eliminated && !hypothesisStates.length) validated = "ELIMINATED";
  else if (supporting.length >= 2 && independentSources.size >= 2) validated = "CONFIRMED";
  else if (supporting.length) validated = "SUPPORTED";
  else validated = "SUSPECTED";
  const insufficient = initialOnly || validated === "SUSPECTED";
  const proposedRemediation = String(input.modelRemediation || "");
  const remediation = insufficient && mutation(proposedRemediation)
    ? { disposition: "BLOCKED_INSUFFICIENT_EVIDENCE" as const, reason: "Configuration-changing remediation is blocked until discriminating evidence supports RCA." }
    : mutation(proposedRemediation)
      ? { disposition: "REQUIRES_EXISTING_HITL" as const, reason: "Existing exact-approval, execution, rollback, and verification controls remain required." }
      : { disposition: "ALLOWED_DIAGNOSTIC" as const, reason: "Read-only diagnostics and evidence collection are allowed." };
  const requestedParticipants = [...new Set([...(input.requiredParticipants || []), ...(input.modelEscalateTo || [])].map(x => normalize(x)).filter(Boolean))];
  const proposedAuthoritative = proposed === "ESTABLISHED" ? "CONFIRMED" : proposed;
  const disagreement = proposedAuthoritative && proposedAuthoritative !== validated && !(proposedAuthoritative === "UNCONFIRMED" && insufficient)
    ? `Model proposed ${proposed}; deterministic evidence validation set ${validated}.` : undefined;
  return { modelProposedState: proposed, validatedEvidenceState: validated, overallRcaState: insufficient ? "INSUFFICIENT_EVIDENCE" : validated, remediation, requestedParticipants, disagreement };
}
