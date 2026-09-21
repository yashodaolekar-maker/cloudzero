import { KNOWLEDGE_BASE, type KBArticle } from "../data/kb.ts";
import type { IncidentAggregate, IncidentEvidence } from "../types.ts";
import type { IncidentDomainEvent } from "./incident-runtime.ts";

export type GroundingStatus = "GROUNDED" | "PARTIAL" | "ABSTAINED";

export type GroundingCitation =
  | {
      kind: "EVIDENCE";
      evidenceId: string;
      source: string;
      observedAt: string;
      integrityHash?: string;
    }
  | {
      kind: "EVENT";
      eventId: string;
      source: string;
      observedAt: string;
      integrityHash?: string;
    }
  | {
      kind: "KNOWLEDGE";
      kbId: string;
      source: "KNOWLEDGE_BASE";
    };

export interface GroundedAnswer {
  text: string;
  groundingStatus: GroundingStatus;
  citations: GroundingCitation[];
  limitations: string[];
  actionBlocked: boolean;
}

export interface GroundedPostmortem extends GroundedAnswer {
  markdown: string;
}

const MAX_QUESTION_LENGTH = 600;
const MAX_FACT_LENGTH = 600;
const MAX_ANSWER_LENGTH = 12_000;
const MAX_ITEMS = 12;
const MAX_POSTMORTEM_ITEMS = 6;

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "been", "before", "could", "does", "from", "have", "incident",
  "into", "more", "please", "show", "that", "their", "there", "these", "they", "this", "what", "when",
  "where", "which", "with", "would", "your"
]);

const EXECUTION_EVENT_TYPES = new Set([
  "SafeActionExecuted",
  "SafeActionRolledBack",
  "SafeActionExecutionFailed",
  "RemediationExecuted",
  "VoiceBridgeAudioPublished",
  "VoiceBridgePlaybackSimulated",
  "CyberFusionWorkNotePublished"
]);

const RECOMMENDATION_EVENT_TYPES = new Set(["RecommendationCreated", "RecommendationAccepted"]);

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sanitizeText(value: unknown, maxLength = MAX_FACT_LENGTH): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "";
  return String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeId(value: unknown): string {
  return sanitizeText(value, 180).replace(/[^a-zA-Z0-9._:@/-]/g, "_");
}

function markdownText(value: unknown, maxLength = MAX_FACT_LENGTH): string {
  return sanitizeText(value, maxLength).replace(/([\\`*_{}\[\]#|])/g, "\\$1");
}

function tokens(value: string): Set<string> {
  return new Set(
    sanitizeText(value, MAX_QUESTION_LENGTH)
      .toLowerCase()
      .match(/[a-z0-9][a-z0-9._:-]{2,}/g)
      ?.filter(token => !STOP_WORDS.has(token)) || []
  );
}

function stringPayloadValue(payload: unknown, key: string): string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  return sanitizeText((payload as Record<string, unknown>)[key]);
}

function payloadRecord(payload: unknown, key: string): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const candidate = (payload as Record<string, unknown>)[key];
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? candidate as Record<string, unknown>
    : undefined;
}

function evidenceCitation(evidence: IncidentEvidence): GroundingCitation {
  const integrityHash = sanitizeText(evidence.integrityHash, 180);
  return {
    kind: "EVIDENCE",
    evidenceId: safeId(evidence.id),
    source: sanitizeText(evidence.source, 180) || "UNKNOWN_SOURCE",
    observedAt: sanitizeText(evidence.observedAt, 80) || "UNKNOWN_TIME",
    ...(integrityHash ? { integrityHash } : {})
  };
}

function eventCitation(event: IncidentDomainEvent): GroundingCitation {
  const integrityHash = stringPayloadValue(event.payload, "integrityHash") || stringPayloadValue(event.payload, "actionDigest");
  return {
    kind: "EVENT",
    eventId: safeId(event.id),
    source: sanitizeText(event.actorId, 180) || "UNKNOWN_ACTOR",
    observedAt: sanitizeText(event.occurredAt, 80) || "UNKNOWN_TIME",
    ...(integrityHash ? { integrityHash: sanitizeText(integrityHash, 180) } : {})
  };
}

function citationKey(citation: GroundingCitation): string {
  if (citation.kind === "EVIDENCE") return `E:${citation.evidenceId}`;
  if (citation.kind === "EVENT") return `D:${citation.eventId}`;
  return `K:${citation.kbId}`;
}

function uniqueCitations(citations: GroundingCitation[]): GroundingCitation[] {
  const seen = new Set<string>();
  return citations.filter(citation => {
    const key = citationKey(citation);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function incidentEvents(incident: IncidentAggregate, events: IncidentDomainEvent[]): IncidentDomainEvent[] {
  return events
    .filter(event => event.incidentId === incident.incidentId)
    .slice()
    .sort((left, right) => stableCompare(left.occurredAt, right.occurredAt) || stableCompare(left.id, right.id));
}

function incidentEvidence(incident: IncidentAggregate): IncidentEvidence[] {
  return incident.evidence
    .filter(evidence => evidence.incidentId === incident.incidentId)
    .slice()
    .sort((left, right) => stableCompare(left.observedAt, right.observedAt) || stableCompare(left.id, right.id));
}

function isActionIntent(question: string): boolean {
  const normalized = sanitizeText(question, MAX_QUESTION_LENGTH).toLowerCase();
  const action = "execute|restart|reboot|remediate|fix|deploy|apply|patch|isolate|quarantine|reroute|failover|fail over|rollback|shut down|disable|delete|terminate|block|change|modify|configure|promote|scale";
  return new RegExp(`\\b(?:please\\s+|can\\s+you\\s+|could\\s+you\\s+|go\\s+ahead\\s+and\\s+|proceed\\s+to\\s+|should\\s+(?:we|you|i)\\s+)?(?:${action})\\b`, "i").test(normalized);
}

function isExecutionHistoryQuestion(question: string): boolean {
  return /\b(what|which|list|show|were|was|has|have)\b.*\b(executed|performed|applied|remediated|rolled back|actions?)\b/i.test(question)
    || /\b(actions?|remediation)\b.*\b(executed|performed|recorded|completed)\b/i.test(question);
}

function isRootCauseQuestion(question: string): boolean {
  return /\b(root cause|caused|cause of|why did|why is|responsible for)\b/i.test(question);
}

function isAggregateQuestion(question: string): boolean {
  return /\b(status|severity|title|summary|what happened|lifecycle|mode)\b/i.test(question);
}

function isEvidenceQuestion(question: string): boolean {
  return /\b(evidence|observations?|signals?|telemetry|findings?)\b/i.test(question);
}

function isNumericQuestion(question: string): boolean {
  return /\b(how many|how much|number|count|percentage|percent|rate|latency|cpu|memory|throughput|requests per second|packet loss)\b/i.test(question);
}

function matchingEvidence(question: string, evidence: IncidentEvidence[]): IncidentEvidence[] {
  const queryTokens = tokens(question);
  if (!queryTokens.size) return [];
  return evidence
    .map(item => {
      const searchable = tokens(`${item.source} ${item.summary}`);
      const overlap = [...queryTokens].filter(token => searchable.has(token)).length;
      return { item, overlap };
    })
    .filter(match => match.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || stableCompare(left.item.observedAt, right.item.observedAt) || stableCompare(left.item.id, right.item.id))
    .slice(0, MAX_ITEMS)
    .map(match => match.item);
}

function confirmedRootCause(
  evidence: IncidentEvidence[],
  events: IncidentDomainEvent[]
): { statements: string[]; citations: GroundingCitation[] } {
  const statements: string[] = [];
  const citations: GroundingCitation[] = [];

  for (const event of events) {
    if (event.type !== "RootCauseConfirmed") continue;
    const statement = stringPayloadValue(event.payload, "rootCause") || stringPayloadValue(event.payload, "summary") || stringPayloadValue(event.payload, "cause");
    if (!statement) continue;
    statements.push(statement);
    citations.push(eventCitation(event));
  }

  for (const item of evidence) {
    const status = stringPayloadValue(item.payload, "rootCauseStatus") || stringPayloadValue(item.payload, "causalStatus");
    if (status.toUpperCase() !== "CONFIRMED") continue;
    const statement = stringPayloadValue(item.payload, "rootCause") || stringPayloadValue(item.payload, "cause") || sanitizeText(item.summary);
    if (!statement) continue;
    statements.push(statement);
    citations.push(evidenceCitation(item));
  }

  return { statements: [...new Set(statements)].slice(0, MAX_ITEMS), citations: uniqueCitations(citations) };
}

function actionRecordLine(event: IncidentDomainEvent): string {
  const details: string[] = [];
  for (const key of ["recommendationId", "approvalId", "workflowId", "executionId"] as const) {
    const value = stringPayloadValue(event.payload, key);
    if (value) details.push(`${key}=${safeId(value)}`);
  }
  const result = payloadRecord(event.payload, "result");
  const resultStatus = sanitizeText(result?.status, 80);
  if (resultStatus) details.push(`result=${resultStatus}`);
  return `${sanitizeText(event.type, 100)} recorded at ${sanitizeText(event.occurredAt, 80)} by ${sanitizeText(event.actorId, 180)}${details.length ? ` (${details.join(", ")})` : ""}.`;
}

function boundedAnswer(answer: GroundedAnswer): GroundedAnswer {
  return {
    ...answer,
    text: sanitizeText(answer.text, MAX_ANSWER_LENGTH),
    citations: uniqueCitations(answer.citations).slice(0, MAX_ITEMS * 2),
    limitations: [...new Set(answer.limitations.map(item => sanitizeText(item, 400)).filter(Boolean))].slice(0, MAX_ITEMS)
  };
}

function actionControlAnswer(incident: IncidentAggregate, events: IncidentDomainEvent[]): GroundedAnswer {
  const boundApproval = incident.approvals.find(approval =>
    approval.incidentId === incident.incidentId &&
    approval.workflowId &&
    incident.workflows.some(workflow => workflow.id === approval.workflowId && workflow.incidentId === incident.incidentId) &&
    approval.payload?.approvalKind === "REMEDIATION_EXECUTION" &&
    typeof approval.payload?.recommendationId === "string"
  );
  const matchingEvents = boundApproval
    ? events.filter(event => event.payload && typeof event.payload === "object" && (event.payload as Record<string, unknown>).approvalId === boundApproval.id)
    : [];
  const incidentId = safeId(incident.incidentId);
  const approvalId = boundApproval ? safeId(boundApproval.id) : "{approvalId}";
  const recommendationId = boundApproval ? safeId(boundApproval.payload.recommendationId) : "{recommendationId}";
  const workflow = boundApproval ? ` Bound workflow: ${safeId(boundApproval.workflowId)}; approval: ${approvalId}; recommendation: ${recommendationId}; status: ${sanitizeText(boundApproval.status, 40)}.` : " No exact remediation workflow and approval are present in this aggregate.";
  const text = [
    "Action request blocked: this grounded-response function cannot authorize or execute a change.",
    workflow,
    `Required control path: create a grounded recommendation with POST /api/agent-runtime/incidents/${incidentId}/investigate; review its exact pending gate with POST /api/approve-action using {\"approvalId\":\"${approvalId}\",\"status\":\"APPROVED\"}; then invoke POST /api/agent-runtime/recommendations/${recommendationId}/execute-safe using {\"approvalId\":\"${approvalId}\"}.`,
    "Execution remains subject to the exact incidentId, workflowId, recommendationId, action digest, target, parameters, expiry, operating mode, quality gate, and current policy checks. Approval alone does not record execution."
  ].join(" ");
  return boundedAnswer({
    text,
    groundingStatus: boundApproval ? "GROUNDED" : "PARTIAL",
    citations: matchingEvents.slice(0, MAX_ITEMS).map(eventCitation),
    limitations: boundApproval ? [] : ["No exact remediation approval binding is persisted in the supplied incident aggregate."],
    actionBlocked: true
  });
}

function executionHistoryAnswer(incident: IncidentAggregate, events: IncidentDomainEvent[]): GroundedAnswer {
  const actual = events.filter(event => EXECUTION_EVENT_TYPES.has(event.type)).slice(0, MAX_ITEMS);
  const recommendations = events.filter(event => RECOMMENDATION_EVENT_TYPES.has(event.type)).slice(0, MAX_ITEMS);
  if (!actual.length) {
    return boundedAnswer({
      text: recommendations.length
        ? `No actually executed remediation event is persisted for incident ${safeId(incident.incidentId)}. ${recommendations.length} recommendation event(s) are present, but a recommendation is not execution.`
        : `No actually executed remediation event is persisted for incident ${safeId(incident.incidentId)}.`,
      groundingStatus: recommendations.length ? "PARTIAL" : "ABSTAINED",
      citations: recommendations.map(eventCitation),
      limitations: ["Only explicit execution, rollback, failure, bridge-publication, or remediation-executed events count as actions actually recorded."],
      actionBlocked: false
    });
  }
  return boundedAnswer({
    text: `Actions actually recorded for incident ${safeId(incident.incidentId)}: ${actual.map(actionRecordLine).join(" ")}`,
    groundingStatus: "GROUNDED",
    citations: actual.map(eventCitation),
    limitations: ["Provider logs and unstructured event payloads were intentionally excluded."],
    actionBlocked: false
  });
}

/** Answer an incident question using only persisted aggregate fields, evidence, and supplied domain events. */
export function buildGroundedIncidentAnswer(
  question: string,
  incident: IncidentAggregate,
  domainEvents: IncidentDomainEvent[] = []
): GroundedAnswer {
  const cleanQuestion = sanitizeText(question, MAX_QUESTION_LENGTH);
  const evidence = incidentEvidence(incident);
  const events = incidentEvents(incident, domainEvents);
  if (!cleanQuestion) {
    return boundedAnswer({ text: "No answerable question was supplied.", groundingStatus: "ABSTAINED", citations: [], limitations: ["A non-empty incident question is required."], actionBlocked: false });
  }
  if (isExecutionHistoryQuestion(cleanQuestion)) return executionHistoryAnswer(incident, events);
  if (isActionIntent(cleanQuestion)) return actionControlAnswer(incident, events);

  if (isRootCauseQuestion(cleanQuestion)) {
    const rootCause = confirmedRootCause(evidence, events);
    if (!rootCause.statements.length) {
      const related = matchingEvidence(cleanQuestion, evidence);
      return boundedAnswer({
        text: related.length
          ? `Root cause is unconfirmed for incident ${safeId(incident.incidentId)}. Persisted evidence reports: ${related.map(item => `[${safeId(item.id)}] ${sanitizeText(item.summary)}`).join(" ")}`
          : `Root cause is unconfirmed for incident ${safeId(incident.incidentId)}; no persisted confirmation supports an answer.`,
        groundingStatus: related.length ? "PARTIAL" : "ABSTAINED",
        citations: related.map(evidenceCitation),
        limitations: ["No RootCauseConfirmed event or evidence explicitly marked CONFIRMED was supplied."],
        actionBlocked: false
      });
    }
    return boundedAnswer({
      text: `Confirmed root cause for incident ${safeId(incident.incidentId)}: ${rootCause.statements.join(" ")}`,
      groundingStatus: "GROUNDED",
      citations: rootCause.citations,
      limitations: [],
      actionBlocked: false
    });
  }

  const matched = isEvidenceQuestion(cleanQuestion) ? evidence.slice(0, MAX_ITEMS) : matchingEvidence(cleanQuestion, evidence);
  if (matched.length) {
    const numericRequested = isNumericQuestion(cleanQuestion);
    const containsRecordedNumber = matched.some(item => /\d/.test(item.summary));
    return boundedAnswer({
      text: matched.map(item => `Evidence ${safeId(item.id)} from ${sanitizeText(item.source, 180)} at ${sanitizeText(item.observedAt, 80)} reports: ${sanitizeText(item.summary)}`).join(" "),
      groundingStatus: numericRequested && !containsRecordedNumber ? "PARTIAL" : "GROUNDED",
      citations: matched.map(evidenceCitation),
      limitations: numericRequested && !containsRecordedNumber ? ["No persisted numeric value answers the requested measurement; no value was inferred."] : [],
      actionBlocked: false
    });
  }

  if (isAggregateQuestion(cleanQuestion)) {
    return boundedAnswer({
      text: `Incident ${safeId(incident.incidentId)} is titled "${sanitizeText(incident.title, 240)}". Persisted severity is ${sanitizeText(incident.severity, 40)}, lifecycle state is ${sanitizeText(incident.lifecycleState, 80)}, operating mode is ${sanitizeText(incident.operatingMode, 40)}, and aggregate updatedAt is ${sanitizeText(incident.updatedAt, 80)}.`,
      groundingStatus: "GROUNDED",
      citations: [],
      limitations: ["Aggregate header fields do not carry individual evidence IDs."],
      actionBlocked: false
    });
  }

  return boundedAnswer({
    text: `I cannot answer that question for incident ${safeId(incident.incidentId)} from the supplied persisted evidence.`,
    groundingStatus: "ABSTAINED",
    citations: [],
    limitations: ["No persisted evidence or domain event directly matches the question."],
    actionBlocked: false
  });
}

/** Create an auditable ITSM RCA from structured records only; raw log text is never accepted or rendered. */
export function buildGroundedPostmortem(
  incident: IncidentAggregate,
  domainEvents: IncidentDomainEvent[] = []
): GroundedPostmortem {
  const allEvidence = incidentEvidence(incident);
  const evidence = allEvidence.slice(0, MAX_POSTMORTEM_ITEMS);
  const events = incidentEvents(incident, domainEvents);
  const actions = events.filter(event => EXECUTION_EVENT_TYPES.has(event.type)).slice(0, MAX_POSTMORTEM_ITEMS);
  const rootCause = confirmedRootCause(allEvidence, events);
  const unknowns: string[] = [];
  if (!evidence.length) unknowns.push("No persisted incident evidence was supplied.");
  if (!actions.length) unknowns.push("No actual execution or rollback event was recorded.");
  if (!rootCause.statements.length) unknowns.push("Root cause remains unconfirmed.");
  const missingHashes = allEvidence.filter(item => !sanitizeText(item.integrityHash, 180)).length;
  if (missingHashes) unknowns.push(`${missingHashes} evidence item(s) do not have a persisted integrity hash.`);
  const itsm = evidence.map(item => payloadRecord(item.payload, "itsmRca")).find(Boolean);
  const itsmText = (key: string, fallback: string) => sanitizeText(itsm?.[key], 1200) || fallback;
  const itsmList = (key: string) => Array.isArray(itsm?.[key])
    ? (itsm![key] as unknown[]).map(item => sanitizeText(item, 900)).filter(Boolean).slice(0, 8)
    : [];
  const issueSummary = itsmText("issueSummary", `${incident.title}. No evidence-backed narrative summary was recorded.`);
  const impact = itsmText("impact", "Business and user impact were not quantified in the supplied evidence.");
  const rootCauseStatement = itsmText("rootCause", rootCause.statements[0] || "Root cause is not confirmed by the supplied evidence.");
  const contributingFactors = itsmList("contributingFactors");
  const fiveWhys = itsmList("fiveWhys");
  const temporaryFix = itsmText("temporaryFix", actions.length ? "See the recorded-action section; no separate temporary-fix classification was supplied." : "NOT RECORDED: no temporary mitigation or executed recovery event was supplied.");
  const permanentFix = itsmText("permanentFix", "NOT RECORDED: permanent corrective action requires owner review and supporting evidence.");
  const validation = itsmList("validation");
  const owner = itsmText("owner", "Unassigned in the supplied incident record.");
  const preventionActions = itsmList("preventionActions");

  const lines = [
    `# ITSM Root Cause Analysis: ${markdownText(incident.incidentId, 180)}`,
    "",
    "## 1. Issue summary",
    markdownText(issueSummary, 1200),
    "",
    "## 2. Service and business impact",
    markdownText(impact, 1200),
    "",
    "## 3. Incident classification",
    `- Title: ${markdownText(incident.title, 240)}`,
    `- Severity: ${markdownText(incident.severity, 40)}`,
    `- Lifecycle state: ${markdownText(incident.lifecycleState, 80)}`,
    `- Operating mode: ${markdownText(incident.operatingMode, 40)}`,
    `- Aggregate updated at: ${markdownText(incident.updatedAt, 80)}`,
    "",
    "## 4. Evidence-backed timeline",
    ...(evidence.length
      ? evidence.map(item => `- ${markdownText(item.observedAt, 80)} — [${markdownText(item.id, 180)}] ${markdownText(item.summary, 500)}`)
      : ["- No evidence timeline was recorded."]),
    "",
    "## 5. Root cause",
    `- Status: ${rootCause.statements.length ? "CONFIRMED" : "UNCONFIRMED"}`,
    `- Technical cause: ${markdownText(rootCauseStatement, 1200)}`,
    "",
    "## 6. Contributing factors",
    ...(contributingFactors.length ? contributingFactors.map(item => `- ${markdownText(item, 900)}`) : ["- No contributing factors were proven by the supplied record."]),
    "",
    "## 7. Five whys",
    ...(fiveWhys.length ? fiveWhys.map((item, index) => `${index + 1}. ${markdownText(item, 900)}`) : ["1. EVIDENCE GAP: a five-whys chain cannot be completed until a root cause and contributing evidence are confirmed."]),
    "",
    "## 8. Temporary fix or containment",
    markdownText(temporaryFix, 1200),
    "",
    "## 9. Permanent corrective action",
    markdownText(permanentFix, 1200),
    "",
    "## 10. Recovery validation",
    ...(validation.length ? validation.map(item => `- ${markdownText(item, 900)}`) : ["- No recovery validation criteria were recorded."]),
    "",
    "## 11. Corrective and preventive actions",
    `- Accountable owner: ${markdownText(owner, 500)}`,
    ...(preventionActions.length ? preventionActions.map(item => `- ${markdownText(item, 900)}`) : ["- Action plan requires assignment, target dates, and closure evidence."]),
    "",
    "## 12. Actions actually recorded",
    ...(actions.length ? actions.map(event => `- [${markdownText(event.id, 180)}] ${markdownText(actionRecordLine(event), 500)}`) : ["- None recorded. Proposed fixes and approvals are not presented as executed changes."]),
    "",
    "## 13. Evidence appendix",
    ...(evidence.length
      ? evidence.map(item => `- [${markdownText(item.id, 180)}] ${markdownText(item.source, 180)} at ${markdownText(item.observedAt, 80)}: ${markdownText(item.summary, 400)}${item.integrityHash ? ` (integrityHash: ${markdownText(item.integrityHash, 180)})` : ""}`)
      : ["- None recorded."]),
    "",
    "## 14. Known unknowns and evidence gaps",
    ...(unknowns.length ? unknowns.map(item => `- ${markdownText(item, 400)}`) : ["- None identified from the supplied structured records."])
  ];
  const markdown = lines.join("\n").slice(0, MAX_ANSWER_LENGTH);
  const citations = uniqueCitations([
    ...evidence.map(evidenceCitation),
    ...actions.map(eventCitation),
    ...rootCause.citations
  ]);
  return {
    text: markdown,
    markdown,
    groundingStatus: evidence.length && rootCause.statements.length ? "GROUNDED" : "PARTIAL",
    citations,
    limitations: unknowns,
    actionBlocked: false
  };
}

function normalizeKnowledgeQuery(value: string): string {
  return sanitizeText(value, MAX_QUESTION_LENGTH).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function conversationalGreeting(question: string): GroundedAnswer | undefined {
  const normalized = normalizeKnowledgeQuery(question);
  const withoutWakeWord = normalized.replace(/\b(apex|apex twin|vijay)\b/g, " ").replace(/\s+/g, " ").trim();
  if (!/^(hi|hello|hey|howdy|good morning|good afternoon|good evening|how are you|how are you doing|how is it going)( today)?$/.test(withoutWakeWord)) {
    return undefined;
  }
  return boundedAnswer({
    text: "I’m doing well and ready to help. Ask me about the network, cloud routing, or security issue you want to work through.",
    groundingStatus: "PARTIAL",
    citations: [],
    limitations: ["This is a conversational response; no operational fact was asserted."],
    actionBlocked: false
  });
}

/** Explicit educational questions can be answered even when an incident is selected. */
export function buildGeneralVoiceKnowledgeAnswer(question: string): GroundedAnswer | undefined {
  const normalized = normalizeKnowledgeQuery(question);
  if (!/\b(do you know about|are you familiar with|tell me about|what is|what are|explain|how does|how do)\b/.test(normalized)) return undefined;
  // Environment observations and execution requests still require incident evidence.
  if (/\b(our|my|this|current|currently|incident|outage|today|yesterday|last|we|execute|apply|restart|reboot)\b/.test(normalized)) return undefined;
  const answer = buildGroundedKnowledgeAnswer(question);
  return answer.groundingStatus === "GROUNDED" && !answer.actionBlocked ? answer : undefined;
}

function directKnowledgeMatch(question: string): KBArticle | undefined {
  const normalized = normalizeKnowledgeQuery(question);
  if (!normalized) return undefined;
  const padded = ` ${normalized} `;
  return KNOWLEDGE_BASE
    .flatMap(article => {
      const phrases = [article.title, ...article.keywords].map(normalizeKnowledgeQuery).filter(Boolean);
      const matches = phrases.filter(phrase => padded.includes(` ${phrase} `));
      const uniqueMatches = [...new Set(matches)];
      const longest = uniqueMatches.sort((left, right) => right.length - left.length)[0];
      return longest ? [{ article, matchCount: uniqueMatches.length, matchLength: uniqueMatches.reduce((total, phrase) => total + phrase.length, 0) }] : [];
    })
    .sort((left, right) => right.matchCount - left.matchCount || right.matchLength - left.matchLength || stableCompare(left.article.id, right.article.id))[0]?.article;
}

/** Retrieve only a direct, literal KB title/keyword match. No generative fallback is used. */
export function buildGroundedKnowledgeAnswer(question: string): GroundedAnswer {
  const cleanQuestion = sanitizeText(question, MAX_QUESTION_LENGTH);
  const greeting = conversationalGreeting(cleanQuestion);
  if (greeting) return greeting;
  const article = directKnowledgeMatch(cleanQuestion);
  if (!article) {
    return boundedAnswer({
      text: "I cannot answer that question from the curated knowledge base because no direct title or keyword match was found.",
      groundingStatus: "ABSTAINED",
      citations: [],
      limitations: ["Fuzzy or generative knowledge retrieval is intentionally disabled."],
      actionBlocked: isActionIntent(cleanQuestion)
    });
  }
  const actionBlocked = isActionIntent(cleanQuestion);
  return boundedAnswer({
    text: `${sanitizeText(article.title, 240)} (${sanitizeText(article.category, 80)}): ${sanitizeText(article.procedure, 2_400)}${actionBlocked ? " Reference only: no action was authorized or executed." : ""}`,
    groundingStatus: "GROUNDED",
    citations: [{ kind: "KNOWLEDGE", kbId: safeId(article.id), source: "KNOWLEDGE_BASE" }],
    limitations: actionBlocked ? ["Knowledge retrieval does not authorize or execute operational changes."] : [],
    actionBlocked
  });
}
