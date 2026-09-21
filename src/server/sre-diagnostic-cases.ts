import crypto from "node:crypto";
import type { IncidentAggregate, IncidentEvidence } from "../types.ts";

type DiagnosticCase = {
  title: string;
  itsmRca: {
    issueSummary: string;
    impact: string;
    rootCause: string;
    contributingFactors: string[];
    fiveWhys: string[];
    temporaryFix: string;
    permanentFix: string;
    validation: string[];
    owner: string;
    preventionActions: string[];
  };
  evidence: Array<{ source: string; observedAt: string; summary: string; confirmedRootCause?: string }>;
};

const CASES: Record<string, DiagnosticCase> = {
  "INC-2026-9041": {
    title: "Ingress socket and database connection exhaustion",
    itsmRca: {
      issueSummary: "Authentication requests timed out at the ingress tier while PostgreSQL rejected new application connections and the replica-group health probe failed in the same incident window.",
      impact: "Authentication traffic experienced upstream timeouts. The available evidence does not contain request volume, affected-user count, duration, or a measured business-impact value.",
      rootCause: "The immediate technical failure was exhaustion of the configured PostgreSQL non-superuser connection limit, which prevented the ingress authentication request from obtaining an upstream database connection.",
      contributingFactors: ["The replica-group health probe failed during the same window.", "No connection-pool utilization, query ownership, or application release evidence was captured, so the trigger for connection growth is not yet proven."],
      fiveWhys: [
        "Why did authentication requests fail? The ingress gateway timed out waiting for its upstream dependency.",
        "Why did the upstream dependency not respond? PostgreSQL rejected new non-superuser connections after reaching its configured limit.",
        "Why was the connection limit reached? The supplied evidence does not show whether connections leaked, demand spiked, queries stalled, or the limit was undersized.",
        "Why was that condition not contained before customer impact? Connection-pool saturation and remaining-capacity alert evidence is absent from this incident record.",
        "Why is the organizational cause unresolved? Deployment, capacity-review, ownership, and change-history records were not attached to the diagnostic evidence."
      ],
      temporaryFix: "PROPOSED: shed or queue excess authentication traffic, recycle only the confirmed unhealthy application pool, and restore database connection headroom under an approved change while monitoring active connections and error rate.",
      permanentFix: "PROPOSED: identify the connection owner from pool and database telemetry, correct any leak or long-running transaction, define a capacity-tested pool budget below the database limit, and alert on remaining connection headroom.",
      validation: ["Confirm database connections remain below the approved threshold under representative load.", "Confirm ingress timeout and authentication error rates return to baseline.", "Confirm replica-group health checks remain successful through the observation window."],
      owner: "Database and application service owners, coordinated by SRE",
      preventionActions: ["Add connection-headroom and pool-wait-time alerts.", "Require load and connection-budget validation in release gates.", "Capture query, pool, deployment, and traffic evidence automatically for recurrence analysis."]
    },
    evidence: [
      { source: "Ingress gateway log", observedAt: "2026-08-04T22:45:01.000Z", summary: "The ingress gateway recorded an upstream connection timeout for the authentication request." },
      { source: "PostgreSQL log", observedAt: "2026-08-04T22:45:12.000Z", summary: "PostgreSQL rejected a non-superuser connection because the configured connection limit was reached.", confirmedRootCause: "The immediate service failure was database connection-limit exhaustion, which prevented the authentication path from obtaining a PostgreSQL connection." },
      { source: "Health-check log", observedAt: "2026-08-04T22:46:00.000Z", summary: "The replica-group health probe failed within the same incident window." }
    ]
  },
  "INC-2026-8912": {
    title: "SAML identity-provider handshake timeout",
    itsmRca: {
      issueSummary: "Authentication assertions were rejected because the presented signing signature had expired; the backup verification attempt did not complete before the ingress callback timed out.",
      impact: "Corporate sign-in callbacks timed out. The supplied evidence does not quantify affected users, regions, or transaction volume.",
      rootCause: "The authentication handshake failed because the token-signing assertion presented an expired cryptographic signature.",
      contributingFactors: ["Fallback verification through the backup hardware security module did not complete within the ingress timeout window.", "Certificate inventory, renewal-job, and change-history evidence is missing."],
      fiveWhys: ["Why could users not complete sign-in? The ingress verification callback timed out.", "Why did verification not complete? The identity service rejected the signing assertion.", "Why was the assertion rejected? Its cryptographic signature was expired.", "Why was an expired signature presented? Renewal and deployment records were not supplied, so this is not proven.", "Why was expiry not prevented or detected earlier? Monitoring and certificate-lifecycle control evidence was not attached."],
      temporaryFix: "PROPOSED: activate a currently valid signing credential through the approved identity-service recovery procedure and verify trust on all relying parties.",
      permanentFix: "PROPOSED: automate signing-certificate inventory, renewal, staged distribution, expiry alerting, and pre-expiry end-to-end authentication tests.",
      validation: ["Validate the signing chain and expiry dates on the active credential.", "Complete test sign-ins through primary and fallback verification paths.", "Confirm callback latency and authentication failures remain at baseline."],
      owner: "Identity and security platform owners",
      preventionActions: ["Alert at multiple certificate-expiry thresholds.", "Test certificate rollover before production activation.", "Record renewal-job and relying-party deployment evidence in the incident timeline."]
    },
    evidence: [
      { source: "Identity service log", observedAt: "2026-08-04T18:10:11.000Z", summary: "The identity service rejected the token-signing assertion because its cryptographic signature had expired.", confirmedRootCause: "The authentication handshake failed because the token-signing assertion presented an expired cryptographic signature." },
      { source: "Identity service log", observedAt: "2026-08-04T18:10:20.000Z", summary: "The identity service retried signature verification through the backup hardware security module." },
      { source: "Ingress gateway log", observedAt: "2026-08-04T18:11:02.000Z", summary: "The ingress gateway timed out while waiting for the corporate identity-provider verification callback." }
    ]
  },
  "INC-2026-7734": {
    title: "Encrypted backup vault re-key collision",
    itsmRca: {
      issueSummary: "Automated backup rotation stopped after authenticated-encryption validation failed and the vault denied access for an invalid token; the core service entered a protected safety state.",
      impact: "Automated backup rotation was interrupted. The evidence does not show backup-loss duration, recovery-point exposure, or whether a restore point became unavailable.",
      rootCause: "The immediate failure was an authenticated-encryption tag mismatch followed by vault denial of an invalid access token. The evidence does not establish the upstream process that produced the mismatched key material or token.",
      contributingFactors: ["Backup rotation depended on successful vault authentication.", "Key-version, token-issuer, rotation-job, and audit records were not included."],
      fiveWhys: ["Why did backup rotation stop? Backup serial generation failed and vault access was denied.", "Why did serial generation fail? Authenticated-encryption validation reported a tag mismatch.", "Why was vault access denied? The presented token was invalid.", "Why were mismatched key material and an invalid token presented? The supplied evidence does not identify the originating rotation or credential workflow.", "Why did controls not prevent the collision? Key-version pinning, preflight validation, and rotation audit evidence is absent."],
      temporaryFix: "PROPOSED: pause rotation, preserve the last verified backup set, restore the last known-good key and token binding under dual approval, then run a non-destructive integrity check.",
      permanentFix: "PROPOSED: make rotation transactions version-aware and atomic, validate key/token bindings before activation, retain rollback metadata, and continuously test restore integrity.",
      validation: ["Verify backup manifest and authenticated-encryption integrity.", "Run an isolated restore test from the latest verified recovery point.", "Confirm subsequent rotation completes and vault authentication remains successful."],
      owner: "Backup platform and security key-management owners",
      preventionActions: ["Add key-version and token-binding preflight checks.", "Require dual control for re-key activation.", "Alert on rotation failure and recovery-point age."]
    },
    evidence: [
      { source: "Backup store log", observedAt: "2026-08-03T12:00:00.000Z", summary: "Backup serial generation stopped after an authenticated-encryption tag mismatch.", confirmedRootCause: "The immediate backup-rotation failure was an authenticated-encryption tag mismatch followed by rejection of the invalid vault token." },
      { source: "Vault security log", observedAt: "2026-08-03T12:00:15.000Z", summary: "Automated backup rotation halted after vault access was denied for an invalid token." },
      { source: "Core service log", observedAt: "2026-08-03T12:01:00.000Z", summary: "The core service recorded a safety-state dump after backup rotation stopped." }
    ]
  }
};

function evidenceFor(incidentId: string, item: DiagnosticCase["evidence"][number], index: number): IncidentEvidence {
  const id = `sre-diagnostic-${incidentId.toLowerCase()}-${index + 1}`;
  const payload = {
    ...(item.confirmedRootCause ? { rootCauseStatus: "CONFIRMED", rootCause: item.confirmedRootCause } : {}),
    ...(index === 0 ? { itsmRca: CASES[incidentId].itsmRca } : {})
  };
  const canonical = JSON.stringify({ id, incidentId, source: item.source, summary: item.summary, observedAt: item.observedAt, payload });
  return { id, incidentId, source: item.source, summary: item.summary, observedAt: item.observedAt, payload,
    provenance: { dataOrigin: "SIMULATION", schemaVersion: "sre-diagnostic-v1" },
    integrityHash: crypto.createHash("sha256").update(canonical).digest("hex") };
}

export function sreDiagnosticIncident(incidentId: string): IncidentAggregate | undefined {
  const diagnostic = CASES[incidentId];
  if (!diagnostic) return undefined;
  const evidence = diagnostic.evidence.map((item, index) => evidenceFor(incidentId, item, index));
  return {
    incidentId, title: diagnostic.title, severity: "P2 - High", lifecycleState: "POSTMORTEM", operatingMode: "SIMULATION",
    workflows: [], crossSiloWorkflows: [], approvals: [], changeRecords: [], evidence,
    updatedAt: evidence.at(-1)!.observedAt
  };
}

export const SRE_DIAGNOSTIC_CASE_IDS = Object.freeze(Object.keys(CASES));
