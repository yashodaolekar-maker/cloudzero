import { createHash } from "node:crypto";
import type {
  CyberCmdbResolution,
  CyberEvidence,
  CyberEvidenceKind,
  CyberFusionAnalysis,
  CyberCorrelationCase,
  CyberConnectorCoverage,
  CyberFusionReplayComparison,
  CyberHypothesis,
  CyberHypothesisDisposition,
  CyberHypothesisType,
  CyberScoreBreakdown,
  CyberShadowProposal,
  CyberSourceFamily,
  CyberTwinAssignment,
  DepartmentType,
  IncidentAggregate,
  NormalizedSecurityAnomaly,
  NormalizedTelemetryMetric,
  ServiceNowIncident,
  TelemetryAnomalySeverity,
  TelemetryConnectorSource,
  TelemetrySnapshot
} from "../types.ts";

export const CYBER_FUSION_SCHEMA_VERSION = "cyber-fusion.schema.v1";
export const CYBER_FUSION_ANALYSIS_VERSION = "cyber-fusion.analysis.v1";
export const CYBER_FUSION_RULE_VERSION = "explainable-rules-graph.v1";
export const CYBER_FUSION_ENGINE_KIND = "EXPLAINABLE_RULES_GRAPH_V1" as const;
export const CYBER_CORRELATION_WINDOW_MINUTES = 30;

const CORRELATION_WINDOW_MS = CYBER_CORRELATION_WINDOW_MINUTES * 60 * 1_000;
const EXPECTED_CONNECTORS: TelemetryConnectorSource[] = [
  "DATADOG",
  "SPLUNK",
  "SOLARWINDS",
  "GOOGLE_CLOUD_MONITORING"
];
const TWIN_ORDER: DepartmentType[] = ["Windows", "Linux", "Database", "Network", "Middleware", "CloudOps"];

const SOURCE_FAMILIES: Record<TelemetryConnectorSource, CyberSourceFamily> = {
  DATADOG: "APPLICATION_OBSERVABILITY",
  SPLUNK: "SIEM",
  SOLARWINDS: "NETWORK_OBSERVABILITY",
  GOOGLE_CLOUD_MONITORING: "CLOUD_MONITORING"
};

/** Static and intentionally narrow. Vendor-supplied technique IDs are never trusted or echoed. */
const ATTACK_SIGNAL_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
  brute_force: ["T1110"],
  credential_stuffing: ["T1110"],
  suspicious_login: ["T1078"],
  valid_accounts: ["T1078"],
  credential_access: ["T1003"],
  credential_dumping: ["T1003"],
  privilege_escalation: ["T1068"],
  exploit_public_facing_application: ["T1190"],
  network_service_scanning: ["T1046"],
  network_scan: ["T1046"],
  lateral_movement: ["T1021"],
  command_and_control: ["T1071"],
  data_encrypted_for_impact: ["T1486"],
  ransomware: ["T1486"],
  denial_of_service: ["T1498"],
  ddos: ["T1498"]
});

const CHANGE_SIGNAL_TYPES = new Set([
  "change_event",
  "configuration_change",
  "deployment_change",
  "firewall_change",
  "route_change",
  "release_event"
]);

const VULNERABILITY_SIGNAL_TYPES = new Set([
  "cve",
  "cve_detected",
  "known_vulnerability",
  "software_vulnerability",
  "vulnerability",
  "vulnerability_exposure",
  "vulnerability_finding"
]);

const EXPLICIT_INCIDENT_ALIAS_KEYS = [
  "ciAliases",
  "cmdbAliases",
  "telemetryAliases",
  "monitoringAliases",
  "assetAliases",
  "monitoringResourceId",
  "telemetryResourceId"
] as const;

const EXPLICIT_RESOURCE_LABEL_KEYS = new Set([
  "ci",
  "ciid",
  "ci_id",
  "cmdbitem",
  "cmdb_item",
  "cmdbname",
  "cmdb_name",
  "configurationitem",
  "configuration_item",
  "assetid",
  "asset_id",
  "host",
  "hostname",
  "nodeid",
  "node_id"
]);

const DOMAIN_KEYWORDS: Record<DepartmentType, readonly string[]> = {
  Windows: ["windows", "win32", "active directory", "iis", "kerberos", "powershell"],
  Linux: ["linux", "rhel", "ubuntu", "centos", "systemd", "kernel", "nfs", "selinux"],
  Database: ["database", "postgres", "postgresql", "mysql", "oracle", "sqlserver", "sql server", "db", "redis"],
  Network: ["network", "router", "switch", "firewall", "interface", "bgp", "ospf", "sdwan", "packet", "latency", "link"],
  Middleware: ["middleware", "kafka", "rabbitmq", "tomcat", "weblogic", "message queue", "api gateway", "apigateway"],
  CloudOps: ["cloud", "kubernetes", "k8s", "container", "pod", "gke", "eks", "aks", "aws", "azure", "gcp", "compute instance"]
};

const HYPOTHESIS_ORDER: CyberHypothesisType[] = [
  "THREAT_CAUSED_OUTAGE",
  "CHANGE_INDUCED",
  "OPERATIONAL_FAILURE",
  "INSUFFICIENT_EVIDENCE"
];

export interface CyberFusionInput {
  snapshot: TelemetrySnapshot;
  incidents?: readonly ServiceNowIncident[];
  incidentAggregates?: readonly IncidentAggregate[];
}

interface CiRecord {
  incidentId: string;
  canonicalCiId: string;
  aliases: string[];
}

interface CiResolutionResult {
  canonicalCiId: string;
  incidentId?: string;
  resolution: CyberCmdbResolution;
  limitation?: string;
}

interface ThreatPair {
  signal: CyberEvidence;
  outage: CyberEvidence;
  lagMs: number;
  independent: boolean;
}

/** Locale-independent UTF-16 code-unit ordering for reproducible hashes on every host. */
function codeUnitCompare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => codeUnitCompare(left, right))
        .map(([key, child]) => [key, canonicalize(child)])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function stableJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

function sha256(value: unknown) {
  return createHash("sha256").update(typeof value === "string" ? value : stableJson(value)).digest("hex");
}

function stableId(prefix: string, value: unknown) {
  return `${prefix}_${sha256(value).slice(0, 24)}`;
}

function round(value: number) {
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function safeText(value: unknown, fallback: string, maxLength = 160) {
  if (typeof value !== "string") return fallback;
  const sanitized = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized ? sanitized.slice(0, maxLength) : fallback;
}

function safeSignalType(value: unknown, fallback: string) {
  return safeText(value, fallback, 80)
    .replace(/[^\p{L}\p{N}._:/ -]/gu, "_")
    .replace(/\s+/g, "_")
    .toLowerCase();
}

function exactKey(value: unknown) {
  if (typeof value !== "string") return "";
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function validCutoff(generatedAt: string) {
  const milliseconds = Date.parse(generatedAt);
  if (!Number.isFinite(milliseconds)) {
    throw new Error("Telemetry snapshot generatedAt must be a valid ISO-8601 timestamp.");
  }
  return { milliseconds, iso: new Date(milliseconds).toISOString() };
}

function boundedTimestamp(value: string, explicitlyAssumed: boolean | undefined, cutoffMs: number, cutoffIso: string) {
  const milliseconds = Date.parse(value);
  if (explicitlyAssumed || !Number.isFinite(milliseconds) || milliseconds > cutoffMs) {
    return { milliseconds: cutoffMs, iso: cutoffIso, assumed: true };
  }
  return { milliseconds, iso: new Date(milliseconds).toISOString(), assumed: false };
}

function normalizedSeverityWeight(severity: TelemetryAnomalySeverity) {
  return { INFO: 0.1, LOW: 0.25, MEDIUM: 0.5, HIGH: 0.75, CRITICAL: 1 }[severity];
}

function confidenceOrDefault(value: number | undefined, severity: TelemetryAnomalySeverity) {
  if (typeof value === "number" && Number.isFinite(value)) return round(value);
  return { INFO: 0.25, LOW: 0.4, MEDIUM: 0.6, HIGH: 0.78, CRITICAL: 0.9 }[severity];
}

function canonicalAttackKey(signalType: string) {
  return signalType.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function attackTechniques(signalType: string) {
  return [...(ATTACK_SIGNAL_MAP[canonicalAttackKey(signalType)] ?? [])].sort();
}

function cveIds(anomaly: NormalizedSecurityAnomaly) {
  const candidates: string[] = [anomaly.signalType, anomaly.title, anomaly.description];
  for (const value of Object.values(anomaly.indicators ?? {})) {
    if (typeof value === "string") candidates.push(value);
  }
  return uniqueSorted(candidates.flatMap((candidate) => candidate.match(/\bCVE-\d{4}-\d{4,7}\b/gi) ?? [])
    .map((candidate) => candidate.toUpperCase()))
    .slice(0, 20);
}

function isVulnerabilityExposure(anomaly: NormalizedSecurityAnomaly, signalType: string, ids: readonly string[]) {
  if (ids.length) return true;
  if (VULNERABILITY_SIGNAL_TYPES.has(canonicalAttackKey(signalType))) return true;
  return /(?:^|[^a-z0-9])(cve|vulnerability|exposure)(?:$|[^a-z0-9])/i.test(anomaly.title);
}

function explicitAliases(metadata: Record<string, unknown> | undefined) {
  if (!metadata) return [];
  const aliases: string[] = [];
  for (const key of EXPLICIT_INCIDENT_ALIAS_KEYS) {
    const value = metadata[key];
    if (typeof value === "string") aliases.push(value);
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") aliases.push(item);
    }
  }
  return aliases;
}

function collectIncidents(input: CyberFusionInput) {
  const candidates = [
    ...(input.incidents ?? []),
    ...(input.incidentAggregates ?? []).flatMap((aggregate) => aggregate.serviceNowIncident ? [aggregate.serviceNowIncident] : [])
  ];
  const records = new Map<string, CiRecord>();
  for (const incident of [...candidates].sort((left, right) => codeUnitCompare(left.id, right.id))) {
    const canonicalCiId = safeText(incident.cmdbItem || incident.cmdbName, incident.id, 160);
    const record = records.get(incident.id) ?? { incidentId: incident.id, canonicalCiId, aliases: [] };
    const aliases = [incident.cmdbItem, incident.cmdbName, ...explicitAliases(incident.metadata)]
      .map(exactKey)
      .filter(Boolean);
    record.aliases = [...new Set([...record.aliases, ...aliases])].sort();
    records.set(incident.id, record);
  }
  return [...records.values()].sort((left, right) => codeUnitCompare(left.incidentId, right.incidentId));
}

function ciAliasRegistry(records: readonly CiRecord[]) {
  const registry = new Map<string, CiRecord[]>();
  for (const record of records) {
    for (const alias of record.aliases) {
      registry.set(alias, [...(registry.get(alias) ?? []), record]);
    }
  }
  return registry;
}

function resourceAliases(resource: { id: string; name?: string; labels?: Record<string, string> }) {
  const aliases = [resource.id, resource.name ?? ""];
  for (const [key, value] of Object.entries(resource.labels ?? {})) {
    if (EXPLICIT_RESOURCE_LABEL_KEYS.has(exactKey(key))) aliases.push(value);
  }
  return [...new Set(aliases.map(exactKey).filter(Boolean))].sort();
}

function resolveCi(
  resource: { id: string; name?: string; labels?: Record<string, string> },
  registry: ReadonlyMap<string, readonly CiRecord[]>
): CiResolutionResult {
  const matches = new Map<string, CiRecord>();
  for (const alias of resourceAliases(resource)) {
    for (const record of registry.get(alias) ?? []) matches.set(`${record.incidentId}\u0000${record.canonicalCiId}`, record);
  }
  if (matches.size === 1) {
    const [record] = matches.values();
    return { canonicalCiId: record.canonicalCiId, incidentId: record.incidentId, resolution: "CMDB_EXACT" };
  }
  if (matches.size > 1) {
    return {
      canonicalCiId: safeText(resource.id, "unresolved-resource"),
      resolution: "AMBIGUOUS",
      limitation: "AMBIGUOUS_EXACT_CMDB_ALIAS"
    };
  }
  const resourceId = safeText(resource.id, "", 160);
  if (resourceId) {
    return {
      canonicalCiId: resourceId,
      resolution: "RESOURCE_EXACT",
      limitation: "CMDB_EXACT_MATCH_NOT_FOUND"
    };
  }
  return {
    canonicalCiId: "unresolved-resource",
    resolution: "UNRESOLVED",
    limitation: "RESOURCE_IDENTIFIER_MISSING"
  };
}

function sanitizedResource(resource: NormalizedTelemetryMetric["resource"] | NormalizedSecurityAnomaly["resource"]) {
  return {
    id: safeText(resource.id, "unresolved-resource", 160),
    type: safeSignalType(resource.type, "unknown"),
    ...(resource.name ? { name: safeText(resource.name, "unnamed-resource", 160) } : {}),
    ...(resource.region ? { region: safeText(resource.region, "unknown", 80) } : {}),
    ...(resource.environment ? { environment: safeText(resource.environment, "unknown", 80) } : {})
  };
}

function evidenceFromAnomaly(
  anomaly: NormalizedSecurityAnomaly,
  registry: ReadonlyMap<string, readonly CiRecord[]>,
  cutoffMs: number,
  cutoffIso: string
): CyberEvidence {
  const signalType = safeSignalType(anomaly.signalType, "unknown_security_signal");
  const detectedCveIds = cveIds(anomaly);
  const signalKey = canonicalAttackKey(signalType);
  const kind: CyberEvidenceKind = CHANGE_SIGNAL_TYPES.has(signalKey)
    ? "CHANGE_SIGNAL"
    : ATTACK_SIGNAL_MAP[signalKey]
      ? "THREAT_SIGNAL"
      : isVulnerabilityExposure(anomaly, signalType, detectedCveIds)
        ? "VULNERABILITY_EXPOSURE"
        : "THREAT_SIGNAL";
  const timestamp = boundedTimestamp(anomaly.observedAt, anomaly.observedAtAssumed, cutoffMs, cutoffIso);
  const collected = boundedTimestamp(anomaly.collectedAt, false, cutoffMs, cutoffIso);
  const ci = resolveCi(anomaly.resource, registry);
  const techniques = kind === "THREAT_SIGNAL" ? attackTechniques(signalType) : [];
  const resource = sanitizedResource(anomaly.resource);
  const limitations = [
    ...(ci.limitation ? [ci.limitation] : []),
    ...(timestamp.assumed ? ["OBSERVED_AT_ASSUMED_OR_CUTOFF_CLAMPED"] : []),
    ...(anomaly.stale || anomaly.freshness === "STALE" ? ["STALE_EVIDENCE"] : []),
    ...(anomaly.dataOrigin === "SIMULATION" ? ["SIMULATED_EVIDENCE"] : []),
    ...(kind === "VULNERABILITY_EXPOSURE" ? ["EXPOSURE_ALONE_IS_NON_CAUSAL"] : []),
    ...(kind === "THREAT_SIGNAL" && techniques.length === 0 ? ["NO_ALLOWLISTED_ATTACK_MAPPING"] : [])
  ].sort();
  const semantic = {
    source: anomaly.source,
    sourceFamily: SOURCE_FAMILIES[anomaly.source],
    dataOrigin: anomaly.dataOrigin,
    kind,
    signalType,
    severity: anomaly.severity,
    confidence: confidenceOrDefault(anomaly.confidence, anomaly.severity),
    observedAt: timestamp.iso,
    collectedAt: collected.iso,
    freshness: anomaly.freshness,
    stale: anomaly.stale || anomaly.freshness === "STALE",
    observedAtAssumed: timestamp.assumed,
    resource,
    canonicalCiId: ci.canonicalCiId,
    incidentId: ci.incidentId,
    cmdbResolution: ci.resolution,
    attackTechniqueIds: techniques,
    cveIds: detectedCveIds,
    limitations
  };
  const integrityHash = sha256(semantic);
  return {
    id: `cybev_${integrityHash.slice(0, 24)}`,
    integrityHash,
    sourceRecordHashes: [sha256(anomaly.id)],
    duplicateCount: 1,
    ...semantic,
    summary: `${kind === "CHANGE_SIGNAL" ? "Change" : kind === "VULNERABILITY_EXPOSURE" ? "Vulnerability exposure" : "Security"} signal ${signalType} was reported for ${resource.name ?? resource.id}.`
  };
}

function evidenceFromMetric(
  metric: NormalizedTelemetryMetric,
  registry: ReadonlyMap<string, readonly CiRecord[]>,
  cutoffMs: number,
  cutoffIso: string
): CyberEvidence {
  const signalType = safeSignalType(metric.name, "degraded_metric");
  const severity: TelemetryAnomalySeverity = metric.health === "CRITICAL" ? "CRITICAL" : "HIGH";
  const timestamp = boundedTimestamp(metric.observedAt, metric.observedAtAssumed, cutoffMs, cutoffIso);
  const collected = boundedTimestamp(metric.collectedAt, false, cutoffMs, cutoffIso);
  const ci = resolveCi(metric.resource, registry);
  const resource = sanitizedResource(metric.resource);
  const limitations = [
    ...(ci.limitation ? [ci.limitation] : []),
    ...(timestamp.assumed ? ["OBSERVED_AT_ASSUMED_OR_CUTOFF_CLAMPED"] : []),
    ...(metric.stale || metric.freshness === "STALE" ? ["STALE_EVIDENCE"] : []),
    ...(metric.dataOrigin === "SIMULATION" ? ["SIMULATED_EVIDENCE"] : [])
  ].sort();
  const semantic = {
    source: metric.source,
    sourceFamily: SOURCE_FAMILIES[metric.source],
    dataOrigin: metric.dataOrigin,
    kind: "AVAILABILITY_SIGNAL" as const,
    signalType,
    severity,
    confidence: metric.health === "CRITICAL" ? 0.95 : 0.75,
    observedAt: timestamp.iso,
    collectedAt: collected.iso,
    freshness: metric.freshness,
    stale: metric.stale || metric.freshness === "STALE",
    observedAtAssumed: timestamp.assumed,
    resource,
    canonicalCiId: ci.canonicalCiId,
    incidentId: ci.incidentId,
    cmdbResolution: ci.resolution,
    attackTechniqueIds: [] as string[],
    cveIds: [] as string[],
    limitations
  };
  const integrityHash = sha256(semantic);
  return {
    id: `cybev_${integrityHash.slice(0, 24)}`,
    integrityHash,
    sourceRecordHashes: [sha256(metric.id)],
    duplicateCount: 1,
    ...semantic,
    summary: `${safeText(metric.displayName || metric.name, "Telemetry metric", 100)} is ${metric.health.toLowerCase()} for ${resource.name ?? resource.id}.`
  };
}

function mergeDuplicates(evidence: readonly CyberEvidence[]) {
  const merged = new Map<string, CyberEvidence>();
  for (const item of [...evidence].sort((left, right) => {
    const idComparison = codeUnitCompare(left.id, right.id);
    return idComparison || codeUnitCompare(left.sourceRecordHashes[0], right.sourceRecordHashes[0]);
  })) {
    const current = merged.get(item.id);
    if (!current) {
      merged.set(item.id, item);
      continue;
    }
    merged.set(item.id, {
      ...current,
      sourceRecordHashes: [...new Set([...current.sourceRecordHashes, ...item.sourceRecordHashes])].sort(),
      duplicateCount: current.duplicateCount + item.duplicateCount
    });
  }
  return [...merged.values()].sort((left, right) => codeUnitCompare(left.observedAt, right.observedAt) || codeUnitCompare(left.id, right.id));
}

export function mapTelemetryToCyberEvidence(input: CyberFusionInput) {
  const cutoff = validCutoff(input.snapshot.generatedAt);
  const registry = ciAliasRegistry(collectIncidents(input));
  const evidence = [
    ...input.snapshot.anomalies.map((anomaly) => evidenceFromAnomaly(anomaly, registry, cutoff.milliseconds, cutoff.iso)),
    ...input.snapshot.metrics
      .filter((metric) => metric.health === "DEGRADED" || metric.health === "CRITICAL")
      .map((metric) => evidenceFromMetric(metric, registry, cutoff.milliseconds, cutoff.iso))
  ];
  return mergeDuplicates(evidence);
}

function uniqueSorted(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function pairThreatsAndOutages(evidence: readonly CyberEvidence[]) {
  const threats = evidence.filter((item) => item.kind === "THREAT_SIGNAL");
  const outages = evidence.filter((item) => item.kind === "AVAILABILITY_SIGNAL");
  const pairs: ThreatPair[] = [];
  for (const signal of threats) {
    for (const outage of outages) {
      const lagMs = Date.parse(outage.observedAt) - Date.parse(signal.observedAt);
      if (lagMs >= 0 && lagMs <= CORRELATION_WINDOW_MS) {
        pairs.push({ signal, outage, lagMs, independent: signal.sourceFamily !== outage.sourceFamily });
      }
    }
  }
  return pairs.sort((left, right) => left.lagMs - right.lagMs || codeUnitCompare(left.signal.id, right.signal.id) || codeUnitCompare(left.outage.id, right.outage.id));
}

function applicableQualityCap(evidence: readonly CyberEvidence[], extraCap = 1) {
  let cap = extraCap;
  if (evidence.some((item) => item.observedAtAssumed)) cap = Math.min(cap, 0.5);
  if (evidence.some((item) => item.stale || item.freshness === "STALE")) cap = Math.min(cap, 0.45);
  if (evidence.some((item) => item.dataOrigin === "SIMULATION")) cap = Math.min(cap, 0.35);
  return cap;
}

function finishScore(
  components: Omit<CyberScoreBreakdown, "preCapTotal" | "appliedCap" | "total">,
  cap = 1
): CyberScoreBreakdown {
  const preCapTotal = round(
    components.base +
    components.temporalAlignment +
    components.independentSources +
    components.severity +
    components.signalConfidence +
    components.ciResolution +
    components.dataFreshness +
    components.liveOrigin +
    components.evidenceDiversity -
    components.contradictionPenalty
  );
  const total = round(Math.min(preCapTotal, cap));
  return {
    ...Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value)])) as typeof components,
    preCapTotal,
    ...(cap < 1 ? { appliedCap: round(cap) } : {}),
    total
  };
}

function hypothesisId(caseId: string, type: CyberHypothesisType, inputHash: string) {
  return stableId("cyhyp", { caseId, type, inputHash, ruleVersion: CYBER_FUSION_RULE_VERSION });
}

function ciScore(resolution: CyberCmdbResolution) {
  if (resolution === "CMDB_EXACT") return 0.1;
  if (resolution === "RESOURCE_EXACT") return 0.07;
  return 0;
}

function supportQuality(supporting: readonly CyberEvidence[], fallback: readonly CyberEvidence[]) {
  return supporting.length ? supporting : fallback;
}

function threatHypothesis(caseId: string, inputHash: string, evidence: readonly CyberEvidence[], resolution: CyberCmdbResolution): CyberHypothesis {
  const threats = evidence.filter((item) => item.kind === "THREAT_SIGNAL");
  const outages = evidence.filter((item) => item.kind === "AVAILABILITY_SIGNAL");
  const pairs = pairThreatsAndOutages(evidence);
  const independentPairs = pairs.filter((pair) => pair.independent);
  const supporting = uniqueSorted(pairs.flatMap((pair) => [pair.signal.id, pair.outage.id]));
  const earliestOutage = outages.length ? Math.min(...outages.map((item) => Date.parse(item.observedAt))) : Number.NaN;
  const contradicting = uniqueSorted(threats
    .filter((item) => Number.isFinite(earliestOutage) && Date.parse(item.observedAt) > earliestOutage)
    .map((item) => item.id));
  const supportEvidence = evidence.filter((item) => supporting.includes(item.id));
  const scoredEvidence = supportQuality(supportEvidence, evidence);
  const bestLag = pairs[0]?.lagMs;
  const maxSeverity = scoredEvidence.length
    ? Math.max(...scoredEvidence.map((item) => normalizedSeverityWeight(item.severity)))
    : 0;
  const avgThreatConfidence = threats.length
    ? threats.reduce((sum, item) => sum + item.confidence, 0) / threats.length
    : 0;
  const temporalPresent = pairs.length > 0;
  const independentPresent = independentPairs.length > 0;
  let cap = applicableQualityCap(scoredEvidence);
  if (!independentPresent) cap = Math.min(cap, 0.49);
  if (!temporalPresent) cap = Math.min(cap, 0.39);
  const scoreBreakdown = finishScore({
    base: threats.length && outages.length ? 0.03 : 0,
    temporalAlignment: bestLag === undefined ? 0 : 0.24 * (1 - bestLag / CORRELATION_WINDOW_MS),
    independentSources: independentPresent ? 0.18 : 0,
    severity: 0.17 * maxSeverity,
    signalConfidence: 0.12 * avgThreatConfidence,
    ciResolution: ciScore(resolution),
    dataFreshness: scoredEvidence.length && scoredEvidence.every((item) => item.freshness === "FRESH" && !item.stale) ? 0.08 : 0,
    liveOrigin: scoredEvidence.length && scoredEvidence.every((item) => item.dataOrigin === "LIVE") ? 0.06 : 0,
    evidenceDiversity: threats.length && outages.length ? 0.05 : 0,
    contradictionPenalty: contradicting.length ? Math.min(0.2, contradicting.length * 0.08) : 0
  }, cap);
  const disposition: CyberHypothesisDisposition = !temporalPresent
    ? "REJECTED"
    : independentPresent && scoreBreakdown.total >= 0.65
      ? "PROMOTED"
      : "CANDIDATE";
  const limitations = uniqueSorted([
    "CORRELATION_DOES_NOT_PROVE_CAUSATION",
    ...(!temporalPresent ? ["NO_THREAT_BEFORE_OUTAGE_PAIR_WITHIN_30_MINUTES"] : []),
    ...(!independentPresent ? ["INDEPENDENT_SOURCE_FAMILIES_REQUIRED"] : []),
    ...(contradicting.length ? ["THREAT_SIGNAL_AFTER_OUTAGE_PRESENT"] : []),
    ...scoredEvidence.flatMap((item) => item.limitations)
  ]);
  const techniques = uniqueSorted(supportEvidence.flatMap((item) => item.attackTechniqueIds));
  return {
    id: hypothesisId(caseId, "THREAT_CAUSED_OUTAGE", inputHash),
    type: "THREAT_CAUSED_OUTAGE",
    rank: 0,
    causalStatus: "UNCONFIRMED",
    disposition,
    title: "Threat activity may have contributed to the outage",
    explanation: temporalPresent
      ? `A threat signal preceded degraded or critical telemetry on the exact case key within the bounded ${CYBER_CORRELATION_WINDOW_MINUTES}-minute window. Independent-source and evidence-quality controls determine promotion.`
      : `No threat signal preceded degraded or critical telemetry on the exact case key within the bounded ${CYBER_CORRELATION_WINDOW_MINUTES}-minute window.`,
    confidenceScore: scoreBreakdown.total,
    scoreBreakdown,
    supportingEvidenceIds: supporting,
    contradictingEvidenceIds: contradicting,
    attackTechniqueIds: techniques,
    limitations
  };
}

function changeHypothesis(caseId: string, inputHash: string, evidence: readonly CyberEvidence[], resolution: CyberCmdbResolution): CyberHypothesis {
  const changes = evidence.filter((item) => item.kind === "CHANGE_SIGNAL");
  const outages = evidence.filter((item) => item.kind === "AVAILABILITY_SIGNAL");
  const pairs = changes.flatMap((change) => outages.map((outage) => ({
    change,
    outage,
    lagMs: Date.parse(outage.observedAt) - Date.parse(change.observedAt),
    independent: change.sourceFamily !== outage.sourceFamily
  }))).filter((pair) => pair.lagMs >= 0 && pair.lagMs <= CORRELATION_WINDOW_MS)
    .sort((left, right) => left.lagMs - right.lagMs || codeUnitCompare(left.change.id, right.change.id));
  const independent = pairs.some((pair) => pair.independent);
  const supporting = uniqueSorted(pairs.flatMap((pair) => [pair.change.id, pair.outage.id]));
  const supportEvidence = evidence.filter((item) => supporting.includes(item.id));
  const scoredEvidence = supportQuality(supportEvidence, evidence);
  let cap = applicableQualityCap(scoredEvidence);
  if (!independent) cap = Math.min(cap, 0.49);
  if (!pairs.length) cap = Math.min(cap, 0.34);
  const scoreBreakdown = finishScore({
    base: changes.length && outages.length ? 0.03 : 0,
    temporalAlignment: pairs[0] ? 0.23 * (1 - pairs[0].lagMs / CORRELATION_WINDOW_MS) : 0,
    independentSources: independent ? 0.18 : 0,
    severity: scoredEvidence.length ? 0.16 * Math.max(...scoredEvidence.map((item) => normalizedSeverityWeight(item.severity))) : 0,
    signalConfidence: changes.length ? 0.1 * (changes.reduce((sum, item) => sum + item.confidence, 0) / changes.length) : 0,
    ciResolution: ciScore(resolution),
    dataFreshness: scoredEvidence.length && scoredEvidence.every((item) => item.freshness === "FRESH" && !item.stale) ? 0.08 : 0,
    liveOrigin: scoredEvidence.length && scoredEvidence.every((item) => item.dataOrigin === "LIVE") ? 0.07 : 0,
    evidenceDiversity: changes.length && outages.length ? 0.05 : 0,
    contradictionPenalty: 0
  }, cap);
  return {
    id: hypothesisId(caseId, "CHANGE_INDUCED", inputHash),
    type: "CHANGE_INDUCED",
    rank: 0,
    causalStatus: "UNCONFIRMED",
    disposition: !pairs.length ? "REJECTED" : independent && scoreBreakdown.total >= 0.65 ? "PROMOTED" : "CANDIDATE",
    title: "A recent change may have preceded the outage",
    explanation: pairs.length
      ? `An allowlisted change-signal category preceded degraded or critical telemetry within ${CYBER_CORRELATION_WINDOW_MINUTES} minutes on the exact case key.`
      : "No structured change signal preceded the outage inside the bounded correlation window.",
    confidenceScore: scoreBreakdown.total,
    scoreBreakdown,
    supportingEvidenceIds: supporting,
    contradictingEvidenceIds: [],
    attackTechniqueIds: [],
    limitations: uniqueSorted([
      "CORRELATION_DOES_NOT_PROVE_CAUSATION",
      ...(!pairs.length ? ["NO_CHANGE_BEFORE_OUTAGE_PAIR_WITHIN_30_MINUTES"] : []),
      ...(!independent ? ["INDEPENDENT_SOURCE_FAMILIES_REQUIRED"] : []),
      ...scoredEvidence.flatMap((item) => item.limitations)
    ])
  };
}

function operationalHypothesis(caseId: string, inputHash: string, evidence: readonly CyberEvidence[], resolution: CyberCmdbResolution): CyberHypothesis {
  const outages = evidence.filter((item) => item.kind === "AVAILABILITY_SIGNAL");
  const qualifyingThreatIds = uniqueSorted(pairThreatsAndOutages(evidence)
    .filter((pair) => pair.independent)
    .flatMap((pair) => [pair.signal.id, pair.outage.id]));
  const families = new Set(outages.map((item) => item.sourceFamily));
  const scoreEvidence = supportQuality(outages, evidence);
  let cap = applicableQualityCap(scoreEvidence);
  if (!outages.length) cap = Math.min(cap, 0.3);
  const scoreBreakdown = finishScore({
    base: outages.length ? 0.16 : 0,
    temporalAlignment: outages.length && !qualifyingThreatIds.length ? 0.1 : 0.02,
    independentSources: families.size >= 2 ? 0.15 : 0,
    severity: outages.length ? 0.25 * Math.max(...outages.map((item) => normalizedSeverityWeight(item.severity))) : 0,
    signalConfidence: outages.length ? 0.08 * (outages.reduce((sum, item) => sum + item.confidence, 0) / outages.length) : 0,
    ciResolution: ciScore(resolution),
    dataFreshness: scoreEvidence.length && scoreEvidence.every((item) => item.freshness === "FRESH" && !item.stale) ? 0.08 : 0,
    liveOrigin: scoreEvidence.length && scoreEvidence.every((item) => item.dataOrigin === "LIVE") ? 0.06 : 0,
    evidenceDiversity: new Set(outages.map((item) => item.signalType)).size >= 2 ? 0.07 : 0.03,
    contradictionPenalty: qualifyingThreatIds.length ? 0.2 : 0
  }, cap);
  return {
    id: hypothesisId(caseId, "OPERATIONAL_FAILURE", inputHash),
    type: "OPERATIONAL_FAILURE",
    rank: 0,
    causalStatus: "UNCONFIRMED",
    disposition: !outages.length ? "REJECTED" : scoreBreakdown.total >= 0.65 ? "PROMOTED" : "CANDIDATE",
    title: "Operational degradation may explain the outage",
    explanation: outages.length
      ? "Degraded or critical telemetry supports an operational-failure hypothesis; qualifying threat-before-outage evidence is treated as contradictory until investigated."
      : "No degraded or critical metric was present at the snapshot cutoff.",
    confidenceScore: scoreBreakdown.total,
    scoreBreakdown,
    supportingEvidenceIds: outages.map((item) => item.id).sort(),
    contradictingEvidenceIds: qualifyingThreatIds,
    attackTechniqueIds: [],
    limitations: uniqueSorted([
      "ROOT_CAUSE_REQUIRES_DOMAIN_VALIDATION",
      ...(!outages.length ? ["NO_DEGRADED_OR_CRITICAL_METRIC"] : []),
      ...scoreEvidence.flatMap((item) => item.limitations)
    ])
  };
}

function insufficientHypothesis(
  caseId: string,
  inputHash: string,
  evidence: readonly CyberEvidence[],
  resolution: CyberCmdbResolution,
  coverage: CyberConnectorCoverage
): CyberHypothesis {
  const families = new Set(evidence.map((item) => item.sourceFamily));
  const threats = evidence.filter((item) => item.kind === "THREAT_SIGNAL");
  const outages = evidence.filter((item) => item.kind === "AVAILABILITY_SIGNAL");
  const noCorrelatedPair = pairThreatsAndOutages(evidence).every((pair) => !pair.independent);
  const scoreBreakdown = finishScore({
    base: 0.08,
    temporalAlignment: noCorrelatedPair ? 0.18 : 0,
    independentSources: families.size < 2 ? 0.15 : 0,
    severity: evidence.length < 2 ? 0.08 : 0,
    signalConfidence: evidence.length && evidence.every((item) => item.confidence < 0.6) ? 0.08 : 0,
    ciResolution: resolution !== "CMDB_EXACT" ? 0.15 : 0,
    dataFreshness: evidence.some((item) => item.stale || item.observedAtAssumed) ? 0.1 : 0,
    liveOrigin: evidence.some((item) => item.dataOrigin === "SIMULATION") ? 0.1 : 0,
    evidenceDiversity: !threats.length || !outages.length ? 0.13 : 0,
    contradictionPenalty: 0
  });
  const adjusted = coverage.missingConnectors.length || coverage.unavailableConnectors.length
    ? finishScore({ ...scoreBreakdown, base: scoreBreakdown.base + 0.08, contradictionPenalty: 0 })
    : scoreBreakdown;
  return {
    id: hypothesisId(caseId, "INSUFFICIENT_EVIDENCE", inputHash),
    type: "INSUFFICIENT_EVIDENCE",
    rank: 0,
    causalStatus: "UNCONFIRMED",
    disposition: adjusted.total >= 0.65 ? "PROMOTED" : "CANDIDATE",
    title: "Available evidence may be insufficient for causal attribution",
    explanation: "Coverage, exact-CMDB resolution, timing, source independence and evidence quality are scored explicitly before any causal hypothesis is promoted.",
    confidenceScore: adjusted.total,
    scoreBreakdown: adjusted,
    supportingEvidenceIds: evidence.map((item) => item.id).sort(),
    contradictingEvidenceIds: [],
    attackTechniqueIds: [],
    limitations: uniqueSorted([
      ...(families.size < 2 ? ["SINGLE_SOURCE_FAMILY"] : []),
      ...(resolution !== "CMDB_EXACT" ? ["CMDB_EXACT_MATCH_NOT_CONFIRMED"] : []),
      ...coverage.missingConnectors.map((source) => `MISSING_CONNECTOR_${source}`),
      ...coverage.unavailableConnectors.map((source) => `UNAVAILABLE_CONNECTOR_${source}`),
      ...evidence.flatMap((item) => item.limitations)
    ])
  };
}

function rankHypotheses(hypotheses: CyberHypothesis[]) {
  return hypotheses
    .sort((left, right) => right.confidenceScore - left.confidenceScore || HYPOTHESIS_ORDER.indexOf(left.type) - HYPOTHESIS_ORDER.indexOf(right.type))
    .map((hypothesis, index) => ({ ...hypothesis, rank: index + 1 }));
}

function shadowProposals(caseId: string, topHypothesis: CyberHypothesis, canonicalCiId: string) {
  const proposals: Omit<CyberShadowProposal, "id">[] = [
    {
      mode: "SHADOW_ONLY",
      kind: "OBSERVATION",
      title: "Preserve the bounded evidence view",
      description: `Retain the normalized evidence and connector freshness state for ${canonicalCiId} at this snapshot cutoff.`,
      rationale: "A stable evidence view is required for audit and replay.",
      target: canonicalCiId,
      risk: "LOW",
      verificationSteps: ["Confirm the evidence manifest and integrity hashes are readable in the replay view."],
      rollbackSummary: "Discard the shadow proposal; no production state is changed.",
      reversible: true,
      executable: false,
      requiresApproval: true
    },
    {
      mode: "SHADOW_ONLY",
      kind: "INVESTIGATION",
      title: "Validate identity, change and dependency evidence",
      description: "Ask the owning domains to verify identity activity, endpoint findings, approved changes and CMDB dependencies without changing production state.",
      rationale: `The leading ${topHypothesis.type} hypothesis remains unconfirmed.`,
      target: canonicalCiId,
      risk: "LOW",
      verificationSteps: ["Record the operator conclusion and evidence IDs that confirm or reject the hypothesis."],
      rollbackSummary: "Close the investigation proposal; no production state is changed.",
      reversible: true,
      executable: false,
      requiresApproval: true
    },
    {
      mode: "SHADOW_ONLY",
      kind: "REVERSIBLE_MITIGATION",
      title: "Prepare a scoped containment or traffic-drain plan",
      description: `Prepare, but do not execute, an approval-gated and time-limited containment or traffic drain affecting only ${canonicalCiId}; require an expiry, health verification and named rollback owner.`,
      rationale: "This is a reversible candidate for operator review if independent evidence confirms impact.",
      target: canonicalCiId,
      risk: "MEDIUM",
      verificationSteps: [
        "Confirm the target still matches the incident and exact CMDB item.",
        "Confirm service health, traffic and security signals against the pre-action baseline.",
        "Require a human decision before creating any executable recommendation."
      ],
      rollbackSummary: "Restore the prior routing or containment state using the approved vendor-native rollback and verify the same health baseline.",
      reversible: true,
      executable: false,
      requiresApproval: true
    }
  ];
  return proposals.map((proposal) => ({
    id: stableId("cyprop", { caseId, kind: proposal.kind, ruleVersion: CYBER_FUSION_RULE_VERSION }),
    ...proposal
  }));
}

function evidenceMatchesDepartment(item: CyberEvidence, department: DepartmentType) {
  const tokens = [item.resource.id, item.resource.type, item.resource.name ?? "", item.signalType].join(" ").toLowerCase();
  return DOMAIN_KEYWORDS[department].some((keyword) => {
    if (keyword.length <= 3) return new RegExp(`(?:^|[^a-z0-9])${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(tokens);
    return tokens.includes(keyword);
  });
}

function twinAssignments(
  analysisId: string,
  caseId: string,
  canonicalCiId: string,
  incidentId: string | undefined,
  inputHash: string,
  snapshotCutoff: string,
  evidence: readonly CyberEvidence[],
  hypotheses: readonly CyberHypothesis[],
  limitations: readonly string[]
): CyberTwinAssignment[] {
  const sharedContext = {
    analysisId,
    caseId,
    canonicalCiId,
    ...(incidentId ? { incidentId } : {}),
    snapshotCutoff,
    inputHash,
    evidenceIds: evidence.map((item) => item.id).sort(),
    hypothesisIds: hypotheses.map((item) => item.id).sort(),
    limitations: [...limitations].sort()
  };
  return TWIN_ORDER.map((department) => {
    const relevantEvidenceIds = evidence.filter((item) => evidenceMatchesDepartment(item, department)).map((item) => item.id).sort();
    const applies = relevantEvidenceIds.length > 0;
    return {
      department,
      twinId: {
        Windows: "agent-windows",
        Linux: "agent-linux",
        Database: "agent-database",
        Network: "agent-network",
        Middleware: "agent-middleware",
        CloudOps: "agent-cloudops"
      }[department],
      status: applies ? "ACTIVE" : "WATCHING",
      rationale: applies
        ? `${department} resource or signal semantics match a static domain rule.`
        : "No domain-specific resource or signal semantics matched; shared context remains available for cross-checking.",
      relevantEvidenceIds,
      investigationObjective: {
        Windows: "Validate Windows host, identity, service and configuration evidence for the exact CI.",
        Linux: "Validate Linux host, kernel, service and access evidence for the exact CI.",
        Database: "Validate database availability, connection, replication and audit evidence for the exact CI.",
        Network: "Validate router, switch, firewall, path and configuration evidence for the exact CI.",
        Middleware: "Validate gateway, messaging, runtime and certificate evidence for the exact CI.",
        CloudOps: "Validate cloud control-plane, workload, deployment and dependency evidence for the exact CI."
      }[department],
      sharedContext
    };
  });
}

function coverageFor(snapshot: TelemetrySnapshot): CyberConnectorCoverage {
  const statusBySource = new Map(snapshot.connectors.map((connector) => [connector.source, connector]));
  const presentConnectors = EXPECTED_CONNECTORS.filter((source) => statusBySource.has(source));
  const usableConnectors = EXPECTED_CONNECTORS.filter((source) => {
    const status = statusBySource.get(source);
    return status && ["CONNECTED", "SIMULATED", "STALE"].includes(status.state);
  });
  return {
    expectedConnectors: [...EXPECTED_CONNECTORS],
    presentConnectors,
    usableConnectors,
    missingConnectors: EXPECTED_CONNECTORS.filter((source) => !statusBySource.has(source)),
    unavailableConnectors: EXPECTED_CONNECTORS.filter((source) => {
      const state = statusBySource.get(source)?.state;
      return state === "UNAVAILABLE" || state === "ERROR";
    }),
    staleConnectors: EXPECTED_CONNECTORS.filter((source) => statusBySource.get(source)?.state === "STALE"),
    simulatedConnectors: EXPECTED_CONNECTORS.filter((source) => {
      const status = statusBySource.get(source);
      return status?.state === "SIMULATED" || status?.dataOrigin === "SIMULATION";
    }),
    ratio: round(usableConnectors.length / EXPECTED_CONNECTORS.length)
  };
}

function normalizedInputHash(input: CyberFusionInput) {
  const sortableSnapshot = {
    ...input.snapshot,
    connectors: [...input.snapshot.connectors].sort((left, right) => codeUnitCompare(left.source, right.source)),
    metrics: [...input.snapshot.metrics].sort((left, right) => codeUnitCompare(left.id, right.id)),
    anomalies: [...input.snapshot.anomalies].sort((left, right) => codeUnitCompare(left.id, right.id))
  };
  const incidents = collectIncidents(input);
  return {
    snapshot: sha256(sortableSnapshot),
    incidents: sha256(incidents),
    combined: sha256({ sortableSnapshot, incidents })
  };
}

export function analyzeCyberFusion(input: CyberFusionInput): CyberFusionAnalysis {
  const cutoff = validCutoff(input.snapshot.generatedAt);
  const inputHashes = normalizedInputHash(input);
  const analysisId = stableId("cyanalysis", {
    schemaVersion: CYBER_FUSION_SCHEMA_VERSION,
    analysisVersion: CYBER_FUSION_ANALYSIS_VERSION,
    ruleVersion: CYBER_FUSION_RULE_VERSION,
    snapshotCutoff: cutoff.iso,
    inputHash: inputHashes.combined
  });
  const coverage = coverageFor(input.snapshot);
  const evidence = mapTelemetryToCyberEvidence(input);
  const groups = new Map<string, CyberEvidence[]>();
  for (const item of evidence) {
    const isolationSuffix = item.cmdbResolution === "AMBIGUOUS" || item.cmdbResolution === "UNRESOLVED" ? `:${item.id}` : "";
    const groupKey = `${item.incidentId ?? "unlinked"}\u0000${exactKey(item.canonicalCiId)}${isolationSuffix}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), item]);
  }
  const cases = [...groups.entries()].map(([groupKey, groupEvidence]): CyberCorrelationCase => {
    const sortedEvidence = [...groupEvidence].sort((left, right) => codeUnitCompare(left.observedAt, right.observedAt) || codeUnitCompare(left.id, right.id));
    const first = sortedEvidence[0];
    const caseId = stableId("cycase", { groupKey, inputHash: inputHashes.combined, ruleVersion: CYBER_FUSION_RULE_VERSION });
    const hypotheses = rankHypotheses([
      threatHypothesis(caseId, inputHashes.combined, sortedEvidence, first.cmdbResolution),
      operationalHypothesis(caseId, inputHashes.combined, sortedEvidence, first.cmdbResolution),
      changeHypothesis(caseId, inputHashes.combined, sortedEvidence, first.cmdbResolution),
      insufficientHypothesis(caseId, inputHashes.combined, sortedEvidence, first.cmdbResolution, coverage)
    ]);
    const limitations = uniqueSorted([
      "V1_EXPLAINABLE_RULES_NOT_TRAINED_ML",
      "ALL_CAUSAL_HYPOTHESES_UNCONFIRMED",
      ...sortedEvidence.flatMap((item) => item.limitations),
      ...coverage.missingConnectors.map((source) => `MISSING_CONNECTOR_${source}`),
      ...coverage.unavailableConnectors.map((source) => `UNAVAILABLE_CONNECTOR_${source}`)
    ]);
    return {
      id: caseId,
      canonicalCiId: first.canonicalCiId,
      ...(first.incidentId ? { incidentId: first.incidentId } : {}),
      cmdbResolution: first.cmdbResolution,
      evidence: sortedEvidence,
      hypotheses,
      topHypothesisId: hypotheses[0].id,
      twinAssignments: twinAssignments(
        analysisId,
        caseId,
        first.canonicalCiId,
        first.incidentId,
        inputHashes.combined,
        cutoff.iso,
        sortedEvidence,
        hypotheses,
        limitations
      ),
      shadowProposals: shadowProposals(caseId, hypotheses[0], first.canonicalCiId),
      limitations
    };
  }).sort((left, right) => codeUnitCompare(left.id, right.id));
  const base = {
    analysisId,
    schemaVersion: CYBER_FUSION_SCHEMA_VERSION,
    analysisVersion: CYBER_FUSION_ANALYSIS_VERSION,
    ruleVersion: CYBER_FUSION_RULE_VERSION,
    engineKind: CYBER_FUSION_ENGINE_KIND,
    causalStatus: "UNCONFIRMED" as const,
    snapshotCutoff: cutoff.iso,
    inputHashes,
    coverage,
    correlationWindowMinutes: CYBER_CORRELATION_WINDOW_MINUTES as 30,
    cases,
    limitations: uniqueSorted([
      "V1_EXPLAINABLE_RULES_NOT_TRAINED_ML",
      "CORRELATION_DOES_NOT_PROVE_CAUSATION",
      "SHADOW_RECOMMENDATIONS_ONLY",
      ...(coverage.ratio < 1 ? ["CONNECTOR_COVERAGE_INCOMPLETE"] : []),
      ...(coverage.simulatedConnectors.length ? ["SIMULATION_DATA_PRESENT"] : [])
    ])
  };
  return { ...base, integrityHash: sha256(base) };
}

function caseDigest(caseItem: CyberCorrelationCase) {
  return sha256({
    id: caseItem.id,
    evidence: caseItem.evidence.map((item) => ({ id: item.id, integrityHash: item.integrityHash, duplicateCount: item.duplicateCount })),
    hypotheses: caseItem.hypotheses,
    twinAssignments: caseItem.twinAssignments,
    shadowProposals: caseItem.shadowProposals
  });
}

export function compareCyberFusionReplay(
  baseline: CyberFusionAnalysis,
  replay: CyberFusionAnalysis
): CyberFusionReplayComparison {
  const baselineCases = new Map(baseline.cases.map((item) => [item.id, item]));
  const replayCases = new Map(replay.cases.map((item) => [item.id, item]));
  const allCaseIds = uniqueSorted([...baselineCases.keys(), ...replayCases.keys()]);
  const addedCaseIds = allCaseIds.filter((id) => !baselineCases.has(id));
  const removedCaseIds = allCaseIds.filter((id) => !replayCases.has(id));
  const changedCaseIds = allCaseIds.filter((id) => {
    const before = baselineCases.get(id);
    const after = replayCases.get(id);
    return before && after ? caseDigest(before) !== caseDigest(after) : false;
  });
  return {
    equivalent: baseline.integrityHash === replay.integrityHash && !addedCaseIds.length && !removedCaseIds.length && !changedCaseIds.length,
    baselineAnalysisId: baseline.analysisId,
    replayAnalysisId: replay.analysisId,
    baselineIntegrityHash: baseline.integrityHash,
    replayIntegrityHash: replay.integrityHash,
    addedCaseIds,
    removedCaseIds,
    changedCaseIds
  };
}

export function replayCyberFusion(input: CyberFusionInput, baseline: CyberFusionAnalysis) {
  const analysis = analyzeCyberFusion(input);
  return { analysis, comparison: compareCyberFusionReplay(baseline, analysis) };
}
