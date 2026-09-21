/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum UserRole {
  ADMIN = "Administrator",
  DEVOPS = "DevOps Platform Engineer",
  NRE = "Network Reliability Engineer (NRE)",
  AUDITOR = "Security Auditor",
  READONLY = "Read-Only Viewer"
}

export interface SSOUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  avatar: string;
  /** Optional identity claims used to localize incident communications. */
  region?: string;
  locale?: string;
  /** Incident domains visible to this persona. Omitted for unrestricted administrators. */
  accessDomains?: string[];
  /** Human-facing specialty title; authorization continues to use role. */
  jobTitle?: string;
}

export type ApprovalStatus = "PENDING" | "APPROVED" | "DENIED";
export type OperatingMode = "SIMULATION" | "LIVE";
export type IncidentLifecycleState =
  | "DETECTED"
  | "TRIAGED"
  | "MAJOR_INCIDENT_DECLARED"
  | "INVESTIGATING"
  | "MITIGATION_PROPOSED"
  | "AWAITING_APPROVAL"
  | "EXECUTING"
  | "VERIFYING"
  | "MONITORING"
  | "RESOLVED"
  | "POSTMORTEM";

export interface HITLApproval {
  id: string;
  /** Required by the orchestrator; optional only while legacy seed data is normalized. */
  incidentId?: string;
  workflowId?: string;
  agentId: string;
  agentName: string;
  action: string;
  system: "ServiceNow" | "Teams" | "LogSystem" | "AWS" | "BackupStore" | "Kubernetes" | "AristaSwitches" | "GitHubActions" | "Cloudflare" | "CiscoWireless" | "CiscoSwitches" | "ACIFabric" | "CiscoRouters" | "CiscoFirewalls" | "PaloAltoFirewalls" | "CiscoISE" | "ActiveDirectory" | "LinuxKernel" | "Database" | "Kafka" | "AzureCloud" | "EnterprisePKI" | string;
  description: string;
  payload: Record<string, any>;
  status: ApprovalStatus;
  requestedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  comment?: string;
}

export type AgentStatus = "MONITORING" | "IDLE" | "RUNNING" | "WAITING_FOR_HITL" | "COMPLETED" | "FAILED";

export interface DigitalTwinAgent {
  id: string;
  name: string;
  role: string;
  specialty: string;
  department?: DepartmentType;
  status: AgentStatus;
  performanceScore: number; // Percentage
  tasksCompleted: number;
  currentTask?: string;
  avatarColor: string;
  systemConnected: string[];
}

export interface SystemLog {
  id: string;
  timestamp: string;
  level: "INFO" | "WARNING" | "ERROR" | "SECURITY";
  source: string;
  message: string;
  checksum: string; // Encryption checksum simulating data integrity
}

export interface BackupItem {
  id: string;
  name: string;
  createdAt: string;
  size: string;
  status: "SUCCESS" | "FAILED" | "ENCRYPTING";
  encryptionType: string;
  backupType: "AUTOMATED" | "MANUAL";
  checksum: string;
}

export interface WorkflowInstance {
  id: string;
  /** Required by the orchestrator; optional only while legacy seed data is normalized. */
  incidentId?: string;
  name: string;
  agentId: string;
  status: "ACTIVE" | "PAUSED" | "SUCCESS" | "FAILED";
  startedAt: string;
  completedAt?: string;
  steps: {
    name: string;
    status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "WAITING_APPROVAL";
    description: string;
    requiresApproval: boolean;
  }[];
}

export interface PerformanceMetrics {
  requestsPerSecond: number;
  activeWorkflows: number;
  cpuUsage: number;
  memoryUsage: number;
  databaseLatency: number; // in ms
  securityScore: number; // 0-100
  p1Incidents?: number;
}

/** Vendor-neutral telemetry contracts consumed by the dashboard and agents. */
export type TelemetryConnectorSource =
  | "DATADOG"
  | "SPLUNK"
  | "SOLARWINDS"
  | "GOOGLE_CLOUD_MONITORING";

export type TelemetryDataOrigin = "LIVE" | "SIMULATION";
export type TelemetryFreshness = "FRESH" | "STALE" | "UNKNOWN";
export type TelemetryHealth = "HEALTHY" | "DEGRADED" | "CRITICAL" | "UNKNOWN";
export type TelemetryConnectorState = "CONNECTED" | "SIMULATED" | "STALE" | "UNAVAILABLE" | "ERROR";
export type TelemetryAnomalySeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface TelemetryResource {
  id: string;
  type: string;
  name?: string;
  region?: string;
  environment?: string;
  /** Non-secret source labels used for correlation. */
  labels?: Record<string, string>;
}

export interface NormalizedTelemetryMetric {
  id: string;
  source: TelemetryConnectorSource;
  dataOrigin: TelemetryDataOrigin;
  name: string;
  displayName: string;
  value: number;
  unit: string;
  observedAt: string;
  collectedAt: string;
  ageSeconds: number;
  freshness: TelemetryFreshness;
  stale: boolean;
  health: TelemetryHealth;
  resource: TelemetryResource;
  /** True when the source did not provide an event timestamp. */
  observedAtAssumed?: boolean;
}

export interface NormalizedSecurityAnomaly {
  id: string;
  source: TelemetryConnectorSource;
  dataOrigin: TelemetryDataOrigin;
  signalType: string;
  title: string;
  description: string;
  severity: TelemetryAnomalySeverity;
  confidence?: number;
  observedAt: string;
  collectedAt: string;
  ageSeconds: number;
  freshness: TelemetryFreshness;
  stale: boolean;
  resource: TelemetryResource;
  /** True when the source did not provide an event timestamp. */
  observedAtAssumed?: boolean;
  /** Sanitized indicators only; credentials and full vendor payloads are never exposed. */
  indicators?: Record<string, string | number | boolean>;
}

export interface TelemetryConnectorStatus {
  source: TelemetryConnectorSource;
  state: TelemetryConnectorState;
  enabled: boolean;
  dataOrigin: TelemetryDataOrigin;
  lastAttemptAt: string;
  lastSuccessAt?: string;
  metricCount: number;
  anomalyCount: number;
  errorCode?: string;
  warnings?: Array<{ code: string; message: string }>;
  message: string;
}

export interface TelemetrySnapshot {
  mode: OperatingMode;
  generatedAt: string;
  expiresAt: string;
  overallHealth: TelemetryHealth;
  cache: {
    hit: boolean;
    ttlSeconds: number;
  };
  connectors: TelemetryConnectorStatus[];
  metrics: NormalizedTelemetryMetric[];
  anomalies: NormalizedSecurityAnomaly[];
}

export interface ChangeRecordStep {
  id: string;
  description: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
}

export interface ChangeRecord {
  id: string;
  incidentId: string;
  title: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "EXECUTED" | "FAILED";
  context: string;
  steps: ChangeRecordStep[];
  openedAt: string;
  openedBy: string;
  executedAt?: string;
}

export interface ServiceNowWorkNote {
  timestamp: string;
  author: string;
  text: string;
}

export interface ServiceNowIncident {
  id: string;
  cmdbItem: string;
  cmdbName: string;
  category: "Wireless" | "Switch" | "SDWAN" | "Windows" | "Linux" | "Database" | "CloudOps" | "DevOps" | "Middleware" | "Security" | "Collaboration";
  shortDescription: string;
  status: "New" | "Assigned" | "In Progress" | "Resolved";
  assignedTo: string;
  severity: "P1 - Critical" | "P2 - High" | "P3 - Moderate";
  openedAt: string;
  elapsedMinutes: number;
  workNotes: ServiceNowWorkNote[];
  /** Normalized region when ServiceNow supplies one directly. */
  region?: string;
  /** Read-only ticket metadata retained for routing and localization decisions. */
  metadata?: Record<string, unknown>;
}

export type IncidentVoiceRegion = "Mexico" | "China" | "India" | "Karnataka" | "TamilNadu" | "Default";
export type IncidentVoiceLocale = "es-MX" | "zh-CN" | "hi-IN" | "kn-IN" | "ta-IN" | "en-US";
export type IncidentVoiceRegionSource = "TICKET_METADATA" | "USER_PROFILE" | "DEFAULT" | "USER_SELECTION";
export type IncidentVoiceBridgeStatus = "NOT_REQUESTED" | "READY_FOR_BRIDGE" | "SIMULATED" | "PUBLISHED" | "FAILED";
export type IncidentVoiceAuditStatus = "SIMULATED" | "PUBLISHED" | "FAILED";

export interface IncidentVoiceOutput {
  incidentId: string;
  region: IncidentVoiceRegion;
  regionSource: IncidentVoiceRegionSource;
  languageCode: IncidentVoiceLocale;
  languageName: "Spanish" | "Mandarin" | "Hindi" | "Kannada" | "Tamil" | "English";
  modelName: string;
  translatedSummary: string;
  translationProvider: "NONE" | "GEMINI" | "LOCAL_NLLB" | "USER_PROVIDED";
  outputFile: "incident_voice_output.wav";
  audioSha256: string;
  audioUrl: string;
  generatedAt: string;
  bridgeStatus: IncidentVoiceBridgeStatus;
  auditStatus: IncidentVoiceAuditStatus;
  message?: string;
}

export type DepartmentType = "Windows" | "Linux" | "Database" | "Network" | "Middleware" | "CloudOps";

export interface A2AMessage {
  id: string;
  fromAgentId: string;
  fromDepartment: DepartmentType;
  toAgentId: string;
  toDepartment: DepartmentType;
  queryType: "MAINTENANCE_CHECK" | "PATCHING_STATUS" | "CERTIFICATE_AUDIT" | "DNS_VALIDATION" | "CONNECTIVITY_PROBE" | "DECOMMISSION_AUDIT";
  subject: string;
  queryPayload: Record<string, any>;
  responsePayload?: Record<string, any>;
  status: "SENT" | "PROCESSING" | "RESPONDED" | "ESCALATED";
  timestamp: string;
  durationMs?: number;
  findingSummary?: string;
  confidenceScore?: number;
}

export interface CrossSiloWorkflow {
  id: string;
  /** Required by the orchestrator; optional only while legacy seed data is normalized. */
  incidentId?: string;
  title: string;
  initiatingDepartment: DepartmentType;
  incidentContext: string;
  status: "INVESTIGATING" | "ROOT_CAUSE_FOUND" | "REMEDIATED" | "RESOLVED" | "WAITING_L3_HITL" | "EXECUTING";
  startedAt: string;
  completedAt?: string;
  dialogue: A2AMessage[];
  correlatedEvents: {
    department: DepartmentType;
    source: string;
    details: string;
    impact: "NONE" | "SUSPECTED" | "ROOT_CAUSE";
  }[];
  concludedRCA?: string;
  recommendedAction?: string;
  rollbackPayload?: string;
  executionLogs?: string[];
  requiredApprovalRole?: string;
}

export interface IncidentEvidence {
  id: string;
  incidentId: string;
  workflowId?: string;
  source: string;
  summary: string;
  confidenceScore?: number;
  observedAt: string;
  payload?: Record<string, any>;
  /** Optional, backward-compatible origin metadata for persisted machine evidence. */
  provenance?: IncidentEvidenceProvenance;
  /** SHA-256 of the canonical, sanitized evidence representation when available. */
  integrityHash?: string;
}

export interface IncidentEvidenceProvenance {
  sourceRecordHash?: string;
  connector?: TelemetryConnectorSource;
  sourceFamily?: CyberSourceFamily;
  dataOrigin?: TelemetryDataOrigin;
  freshness?: TelemetryFreshness;
  stale?: boolean;
  observedAtAssumed?: boolean;
  canonicalCiId?: string;
  cmdbResolution?: CyberCmdbResolution;
  schemaVersion?: string;
}

/**
 * Vendor-neutral cyber-fusion contracts. V1 is deterministic explainable
 * rules/graph correlation; the contracts deliberately do not claim trained ML.
 */
export type CyberSourceFamily =
  | "SIEM"
  | "APPLICATION_OBSERVABILITY"
  | "NETWORK_OBSERVABILITY"
  | "CLOUD_MONITORING";

export type CyberEvidenceKind = "THREAT_SIGNAL" | "VULNERABILITY_EXPOSURE" | "CHANGE_SIGNAL" | "AVAILABILITY_SIGNAL";
export type CyberCmdbResolution = "CMDB_EXACT" | "RESOURCE_EXACT" | "AMBIGUOUS" | "UNRESOLVED";
export type CyberHypothesisType =
  | "THREAT_CAUSED_OUTAGE"
  | "OPERATIONAL_FAILURE"
  | "CHANGE_INDUCED"
  | "INSUFFICIENT_EVIDENCE";
export type CyberHypothesisDisposition = "PROMOTED" | "CANDIDATE" | "REJECTED";
export type CyberCausalStatus = "UNCONFIRMED";

export interface CyberEvidence {
  id: string;
  integrityHash: string;
  sourceRecordHashes: string[];
  duplicateCount: number;
  source: TelemetryConnectorSource;
  sourceFamily: CyberSourceFamily;
  dataOrigin: TelemetryDataOrigin;
  kind: CyberEvidenceKind;
  signalType: string;
  summary: string;
  severity: TelemetryAnomalySeverity;
  confidence: number;
  observedAt: string;
  collectedAt: string;
  freshness: TelemetryFreshness;
  stale: boolean;
  observedAtAssumed: boolean;
  resource: Pick<TelemetryResource, "id" | "type" | "name" | "region" | "environment">;
  canonicalCiId: string;
  incidentId?: string;
  cmdbResolution: CyberCmdbResolution;
  attackTechniqueIds: string[];
  /** Sanitized, syntactically valid CVE identifiers only. */
  cveIds: string[];
  limitations: string[];
}

export interface CyberScoreBreakdown {
  base: number;
  temporalAlignment: number;
  independentSources: number;
  severity: number;
  signalConfidence: number;
  ciResolution: number;
  dataFreshness: number;
  liveOrigin: number;
  evidenceDiversity: number;
  contradictionPenalty: number;
  preCapTotal: number;
  appliedCap?: number;
  total: number;
}

export interface CyberHypothesis {
  id: string;
  type: CyberHypothesisType;
  rank: number;
  causalStatus: CyberCausalStatus;
  disposition: CyberHypothesisDisposition;
  title: string;
  explanation: string;
  confidenceScore: number;
  scoreBreakdown: CyberScoreBreakdown;
  supportingEvidenceIds: string[];
  contradictingEvidenceIds: string[];
  attackTechniqueIds: string[];
  limitations: string[];
}

export type CyberShadowProposalKind = "OBSERVATION" | "INVESTIGATION" | "REVERSIBLE_MITIGATION";

/** A non-executable proposal. It must never be passed to the production executor. */
export interface CyberShadowProposal {
  id: string;
  mode: "SHADOW_ONLY";
  kind: CyberShadowProposalKind;
  title: string;
  description: string;
  rationale: string;
  target: string;
  risk: "LOW" | "MEDIUM";
  verificationSteps: string[];
  rollbackSummary: string;
  reversible: boolean;
  executable: false;
  requiresApproval: true;
}

export interface CyberTwinSharedContext {
  analysisId: string;
  caseId: string;
  canonicalCiId: string;
  incidentId?: string;
  snapshotCutoff: string;
  inputHash: string;
  evidenceIds: string[];
  hypothesisIds: string[];
  limitations: string[];
}

export interface CyberTwinAssignment {
  department: DepartmentType;
  twinId: string;
  status: "ACTIVE" | "WATCHING";
  rationale: string;
  relevantEvidenceIds: string[];
  investigationObjective: string;
  sharedContext: CyberTwinSharedContext;
}

export interface CyberCorrelationCase {
  id: string;
  canonicalCiId: string;
  incidentId?: string;
  cmdbResolution: CyberCmdbResolution;
  evidence: CyberEvidence[];
  hypotheses: CyberHypothesis[];
  topHypothesisId: string;
  twinAssignments: CyberTwinAssignment[];
  shadowProposals: CyberShadowProposal[];
  limitations: string[];
}

export interface CyberConnectorCoverage {
  expectedConnectors: TelemetryConnectorSource[];
  presentConnectors: TelemetryConnectorSource[];
  usableConnectors: TelemetryConnectorSource[];
  missingConnectors: TelemetryConnectorSource[];
  unavailableConnectors: TelemetryConnectorSource[];
  staleConnectors: TelemetryConnectorSource[];
  simulatedConnectors: TelemetryConnectorSource[];
  ratio: number;
}

export interface CyberFusionAnalysis {
  analysisId: string;
  integrityHash: string;
  schemaVersion: string;
  analysisVersion: string;
  ruleVersion: string;
  engineKind: "EXPLAINABLE_RULES_GRAPH_V1";
  causalStatus: CyberCausalStatus;
  snapshotCutoff: string;
  inputHashes: {
    snapshot: string;
    incidents: string;
    combined: string;
  };
  correlationWindowMinutes: 30;
  coverage: CyberConnectorCoverage;
  cases: CyberCorrelationCase[];
  limitations: string[];
}

export interface CyberFusionReplayComparison {
  equivalent: boolean;
  baselineAnalysisId: string;
  replayAnalysisId: string;
  baselineIntegrityHash: string;
  replayIntegrityHash: string;
  addedCaseIds: string[];
  removedCaseIds: string[];
  changedCaseIds: string[];
}

export interface IncidentAggregate {
  incidentId: string;
  title: string;
  severity: ServiceNowIncident["severity"];
  lifecycleState: IncidentLifecycleState;
  operatingMode: OperatingMode;
  serviceNowIncident?: ServiceNowIncident;
  workflows: WorkflowInstance[];
  crossSiloWorkflows: CrossSiloWorkflow[];
  approvals: HITLApproval[];
  changeRecords: ChangeRecord[];
  evidence: IncidentEvidence[];
  updatedAt: string;
}

export interface TeamEnablementMetric {
  pillar: string;
  metric: string;
  value: string;
  baseline: string;
  improvement: string;
  description: string;
}
