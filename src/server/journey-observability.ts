import crypto from "node:crypto";
import type { IncidentDomainEvent } from "./incident-runtime.ts";
import { safePayload } from "./twin-observability.ts";

export function journeyProfile(env = process.env) {
  const threshold = (key: string, max: number) => {
    const n = Number(env[key]);
    return env[key]?.trim() && Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  };
  const thresholds = { interruptionMs: threshold("XLA_ROAM_INTERRUPTION_MS", 600000), packetLossPercent: threshold("XLA_ROAM_PACKET_LOSS_PERCENT", 100), latencyMs: threshold("XLA_ROAM_LATENCY_MS", 600000) };
  return { id: "WIRELESS_ROAMING", name: "Wireless roaming", description: "Per-client AP-to-AP service continuity. AP health alone does not establish user experience.",
    targetState: Object.values(thresholds).every(v => v !== null) ? "CONFIGURED" : "NOT_CONFIGURED", thresholds,
    version: crypto.createHash("sha256").update(JSON.stringify(thresholds)).digest("hex").slice(0, 12) };
}
export function validateRoam(input: any, mode: "LIVE" | "SIMULATION", source: string, now = Date.now()) {
  for (const key of ["sampleId", "clientId", "fromAp", "toAp"]) if (typeof input[key] !== "string" || !/^[A-Za-z0-9_.:@-]{1,160}$/.test(input[key])) throw new Error(`${key} must be a bounded opaque identifier.`);
  if (input.fromAp === input.toAp) throw new Error("Roaming must identify two different access points.");
  if (input.incidentId != null && (typeof input.incidentId !== "string" || !/^[A-Za-z0-9_.:-]{1,160}$/.test(input.incidentId))) throw new Error("Invalid incident ID.");
  if (typeof input.occurredAt !== "string" || !/(Z|[+-]\d\d:\d\d)$/.test(input.occurredAt) || !Number.isFinite(Date.parse(input.occurredAt)) || Date.parse(input.occurredAt) > now + 60000 || Date.parse(input.occurredAt) < now - 30 * 86400000) throw new Error("Provide a timezone-qualified event timestamp within the last 30 days.");
  const measurements: Record<string, number | boolean | null> = {};
  for (const [key, max] of [["interruptionMs", 600000], ["packetLossPercent", 100], ["latencyMs", 600000], ["userExperienceRating", 5]] as const) {
    const value = input[key];
    if (value != null && (typeof value !== "number" || !Number.isFinite(value) || value < (key === "userExperienceRating" ? 1 : 0) || value > max)) throw new Error(`Invalid ${key}.`);
    measurements[key] = value ?? null;
  }
  for (const key of ["authenticationSucceeded", "sessionPreserved"]) {
    if (input[key] != null && typeof input[key] !== "boolean") throw new Error(`Invalid ${key}.`);
    measurements[key] = input[key] ?? null;
  }
  if (Object.values(measurements).every(v => v === null)) throw new Error("Supply at least one observed journey measurement.");
  const id = crypto.createHash("sha256").update(`${mode}:${source}:${input.sampleId}`).digest("hex");
  return { id, sampleId: input.sampleId, incidentId: input.incidentId || null,
    clientId: `client-${crypto.createHash("sha256").update(input.clientId).digest("hex").slice(0, 16)}`,
    fromAp: input.fromAp, toAp: input.toAp, occurredAt: new Date(input.occurredAt).toISOString(), mode, source, ...measurements };
}
export function classifyRoam(sample: any, profile = journeyProfile()) {
  if (sample.authenticationSucceeded === false || sample.sessionPreserved === false) return { experience: "POOR", reason: "Authentication failed or the user's existing session was interrupted." };
  for (const [key, target] of Object.entries(profile.thresholds)) if (target !== null && typeof sample[key] === "number" && sample[key] > target) return { experience: "POOR", reason: `${key} exceeded the configured journey target.` };
  if (profile.targetState !== "CONFIGURED") return { experience: "UNKNOWN", reason: "Journey targets have not been agreed/configured; raw observations are available." };
  if (Object.keys(profile.thresholds).some(key => typeof sample[key] !== "number") || sample.authenticationSucceeded !== true || sample.sessionPreserved !== true) return { experience: "UNKNOWN", reason: "Incomplete per-client journey evidence." };
  return { experience: "GOOD", reason: "All configured journey measurements met targets, authentication succeeded and the session was preserved." };
}
export function projectJourneys(events: IncidentDomainEvent[], filters: { incidentId?: string; mode?: string } = {}, now = Date.now()) {
  const profile = journeyProfile();
  const seen = new Set<string>();
  const samples = events.filter(e => e.type === "WirelessRoamObserved").flatMap(e => {
    const p: any = e.payload;
    if (!p.id || seen.has(p.id) || Date.parse(p.occurredAt) < now - 30 * 86400000 || filters.mode && p.mode !== filters.mode || filters.incidentId && p.incidentId !== filters.incidentId) return [];
    seen.add(p.id);
    return [{ ...safePayload(p), ...classifyRoam(p, profile), evidenceId: e.id }];
  });
  const p95 = (field: string) => { const values = samples.map(s => s[field]).filter(v => typeof v === "number").sort((a,b) => a-b); return values.length ? values[Math.ceil(values.length * .95) - 1] : null; };
  const good = samples.filter(s => s.experience === "GOOD").length, poor = samples.filter(s => s.experience === "POOR").length;
  return { profiles: [profile], summary: { sessions: samples.length, liveSessions: samples.filter(s => s.mode === "LIVE").length, simulatedSessions: samples.filter(s => s.mode === "SIMULATION").length,
    good, poor, unknown: samples.length - good - poor, goodRate: profile.targetState === "CONFIGURED" && good + poor ? good / (good + poor) : null,
    interruptionP95Ms: p95("interruptionMs"), packetLossP95Percent: p95("packetLossPercent"), authenticationFailures: samples.filter(s => s.authenticationSucceeded === false).length,
    sessionDrops: samples.filter(s => s.sessionPreserved === false).length, feedbackCount: samples.filter(s => s.userExperienceRating !== null).length }, samples: samples.slice(-100).reverse() };
}
