import { createHash } from "node:crypto";
import type {
  CyberCorrelationCase,
  CyberFusionAnalysis,
  ServiceNowIncident
} from "../types.ts";
import type { ExternalSignal } from "./connectors.ts";

export const DIGITAL_TWIN_SERVICE_IDENTITY = "service-account:cloudzero-digital-twin";

function text(value: unknown, fallback = "", maxLength = 240) {
  if (typeof value !== "string") return fallback;
  const normalized = value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
}

function displayValue(value: unknown) {
  if (typeof value === "string") return text(value);
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  return text(record.display_value || record.value);
}

function priority(value: unknown): ServiceNowIncident["severity"] {
  const normalized = text(value).toLowerCase();
  if (normalized === "1" || normalized.includes("critical")) return "P1 - Critical";
  if (normalized === "2" || normalized.includes("high")) return "P2 - High";
  return "P3 - Moderate";
}

function status(value: unknown, assignedTo: string): ServiceNowIncident["status"] {
  const normalized = text(value).toLowerCase();
  if (["6", "7", "resolved", "closed"].includes(normalized)) return "Resolved";
  if (["2", "3", "in progress", "on hold"].includes(normalized)) return "In Progress";
  if (assignedTo || normalized === "assigned") return "Assigned";
  return "New";
}

function category(summary: string, resource: string): ServiceNowIncident["category"] {
  const scope = `${summary} ${resource}`.toLowerCase();
  if (/\b(wireless|wi-?fi|wlan|access point)\b/.test(scope)) return "Wireless";
  if (/\b(sd-?wan|wan edge)\b/.test(scope)) return "SDWAN";
  return "Switch";
}

function elapsedMinutes(openedAt: string, now: Date) {
  const opened = Date.parse(openedAt);
  if (!Number.isFinite(opened)) return 0;
  return Math.max(0, Math.floor((now.getTime() - opened) / 60_000));
}

/**
 * Converts the deliberately narrow read connector response into the shared
 * incident contract. Only correlation-safe metadata is retained; raw ticket
 * payloads are never persisted by the service worker.
 */
export function normalizeServiceNowSignals(signals: readonly ExternalSignal[], now = new Date()): ServiceNowIncident[] {
  return signals
    .filter((signal) => signal.source === "ServiceNow")
    .map((signal) => {
      const raw = signal.raw || {};
      const id = text(signal.externalId || raw.number || raw.sys_id, "", 80);
      const assignedTo = displayValue(raw.assigned_to);
      const cmdbValue = typeof raw.cmdb_ci === "object" && raw.cmdb_ci
        ? text((raw.cmdb_ci as Record<string, unknown>).value)
        : text(raw.cmdb_ci);
      const cmdbName = displayValue(raw.cmdb_ci) || text(signal.resource, "unknown-ci", 160);
      const cmdbItem = cmdbValue || cmdbName;
      const openedAtCandidate = text(raw.opened_at || signal.observedAt);
      const openedAtMs = Date.parse(openedAtCandidate);
      const openedAt = Number.isFinite(openedAtMs) ? new Date(openedAtMs).toISOString() : now.toISOString();
      const shortDescription = text(signal.summary || raw.short_description, "ServiceNow incident", 500);
      const region = text(raw.u_region || raw.u_country || raw.location);
      const aliases = [...new Set([cmdbItem, cmdbName].filter(Boolean))];
      return {
        id,
        cmdbItem,
        cmdbName,
        category: category(shortDescription, cmdbName),
        shortDescription,
        status: status(raw.state, assignedTo),
        assignedTo: assignedTo || "CloudZero Digital Twin",
        severity: priority(raw.priority || signal.severity),
        openedAt,
        elapsedMinutes: elapsedMinutes(openedAt, now),
        workNotes: [],
        ...(region ? { region } : {}),
        metadata: {
          source: "ServiceNow",
          openedAtAssumed: !text(raw.opened_at) || !Number.isFinite(Date.parse(text(raw.opened_at))),
          resolvedAt: text(raw.resolved_at || raw.closed_at, "", 80),
          sysId: text(raw.sys_id, "", 80),
          cmdbSysId: cmdbValue,
          ciClass: displayValue(raw["cmdb_ci.sys_class_name"]),
          assignmentGroup: displayValue(raw.assignment_group),
          description: text(raw.description, "", 2000),
          relatedChange: displayValue(raw.caused_by),
          updatedAt: text(raw.sys_updated_on || signal.observedAt, "", 80),
          ciAliases: aliases
        }
      } satisfies ServiceNowIncident;
    })
    .filter((incident) => Boolean(incident.id && incident.cmdbItem));
}

function ascii(value: string) {
  return value.normalize("NFKD").replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "").replace(/[ \t]+/g, " ").trim();
}

function topHypothesis(caseItem: CyberCorrelationCase) {
  return caseItem.hypotheses.find((item) => item.id === caseItem.topHypothesisId) || caseItem.hypotheses[0];
}

/** English-only, bounded work note. It states correlation, never causation. */
export function buildCyberFusionEnglishWorkNote(analysis: CyberFusionAnalysis, caseItem: CyberCorrelationCase) {
  const hypothesis = topHypothesis(caseItem);
  const evidence = caseItem.evidence.slice(0, 8).map((item) =>
    `- ${item.source}: ${item.kind}/${item.signalType}; severity ${item.severity}; ${item.stale ? "stale" : "fresh"}; ${item.dataOrigin.toLowerCase()} data.`
  );
  const activeTwins = caseItem.twinAssignments.filter((item) => item.status === "ACTIVE").map((item) => item.department);
  const proposals = caseItem.shadowProposals.slice(0, 4).map((item) => `- ${item.title} (shadow-only; no execution).`);
  const lines = [
    "CloudZero Digital Twin evidence update",
    `Analysis: ${analysis.analysisId} (${analysis.engineKind}; ${analysis.causalStatus}).`,
    `Incident: ${caseItem.incidentId || "unlinked"}; CI: ${caseItem.canonicalCiId}; mapping: ${caseItem.cmdbResolution}.`,
    hypothesis
      ? `Leading hypothesis: ${hypothesis.title}; score ${Math.round(hypothesis.confidenceScore * 100)}%; disposition ${hypothesis.disposition}. Causation is not confirmed.`
      : "Leading hypothesis: insufficient evidence. Causation is not confirmed.",
    `Connector coverage: ${analysis.coverage.usableConnectors.length}/${analysis.coverage.expectedConnectors.length} usable (${analysis.coverage.usableConnectors.join(", ") || "none"}).`,
    `Digital twins assigned: ${activeTwins.join(", ") || "shared watch only"}.`,
    "Evidence:",
    ...(evidence.length ? evidence : ["- No actionable evidence was present in this snapshot."]),
    "Recommended investigation:",
    ...(proposals.length ? proposals : ["- Continue read-only observation and collect independent evidence."]),
    "No remediation was executed. Human validation remains required."
  ];
  return ascii(lines.join("\n")).slice(0, 4_000);
}

function codeUnitCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Stable material-state digest used to prevent repetitive ServiceNow notes. */
export function cyberFusionWorkNoteSignature(analysis: CyberFusionAnalysis, caseItem: CyberCorrelationCase) {
  const hypothesis = topHypothesis(caseItem);
  const materialState = {
    incidentId: caseItem.incidentId,
    canonicalCiId: caseItem.canonicalCiId,
    cmdbResolution: caseItem.cmdbResolution,
    hypothesis: hypothesis ? {
      type: hypothesis.type,
      disposition: hypothesis.disposition,
      confidenceBucket: Math.floor(hypothesis.confidenceScore * 20) / 20,
      techniques: [...hypothesis.attackTechniqueIds].sort(codeUnitCompare)
    } : null,
    evidence: caseItem.evidence.map((item) => ({
      source: item.source,
      kind: item.kind,
      signalType: item.signalType,
      severity: item.severity,
      stale: item.stale,
      dataOrigin: item.dataOrigin,
      cveIds: [...item.cveIds].sort(codeUnitCompare)
    })).sort((left, right) => codeUnitCompare(JSON.stringify(left), JSON.stringify(right))),
    usableConnectors: [...analysis.coverage.usableConnectors].sort(codeUnitCompare),
    unavailableConnectors: [...analysis.coverage.unavailableConnectors].sort(codeUnitCompare)
  };
  return createHash("sha256").update(JSON.stringify(materialState)).digest("hex");
}
