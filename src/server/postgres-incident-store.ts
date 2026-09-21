import crypto from "node:crypto";
import { Pool } from "pg";
import type { IncidentDomainEvent } from "./incident-runtime.ts";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && typeof item !== "function" && typeof item !== "symbol")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function sha256(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

export function computedHash(event: Omit<IncidentDomainEvent, "eventHash">) { return sha256(event); }

/** Early local demo events hashed a Date as {}, before JSON persisted it as ISO text.
 * Retain the original chain and verify every originally hashed field. The source
 * timestamp on these legacy records was not covered by their original digest.
 */
export function validStoredEventHash(event: IncidentDomainEvent) {
  const { eventHash, ...hashable } = event;
  if (eventHash === computedHash(hashable)) return true;
  const p = event.payload;
  const legacy = ['DemoSessionCreated','DemoInvestigationStarted','DemoInvestigationCompleted','DemoInvestigationFailed','DemoRepairApplied','DemoFaultInjected','DemoInvestigationInterrupted'];
  if (!legacy.includes(event.type) || event.occurredAt >= '2026-09-07T11:47:00.000Z' || p.dataOrigin !== 'SIMULATION' || p.operatingMode !== 'SIMULATION' || typeof p.sourceOccurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*Z$/.test(p.sourceOccurredAt)) return false;
  return eventHash === computedHash({ ...hashable, payload: { ...p, sourceOccurredAt: {} } });
}

export class PostgresIncidentEventStore {
  private readonly pool: Pool;
  private events: IncidentDomainEvent[] = [];
  private initialized = false;
  private writeChain = Promise.resolve();

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
  }

  async initialize() {
    if (this.initialized) return;
    await this.pool.query("SELECT 1");
    const result = await this.pool.query<{
      id: string; incident_id: string; event_type: string; occurred_at: Date; actor_id: string;
      correlation_id: string; payload: Record<string, unknown>; schema_version: number; previous_hash: string; event_hash: string;
    }>(`SELECT id, incident_id, event_type, occurred_at, actor_id, correlation_id, payload,
        schema_version, previous_hash, event_hash FROM incident_events ORDER BY sequence_no ASC`);
    this.events = result.rows.map(row => ({
      id: row.id, incidentId: row.incident_id, type: row.event_type,
      occurredAt: row.occurred_at.toISOString(), actorId: row.actor_id,
      correlationId: row.correlation_id, payload: row.payload,
      schemaVersion: 2, previousHash: row.previous_hash, eventHash: row.event_hash
    }));
    let previousHash = "GENESIS";
    for (const event of this.events) {
      if (event.previousHash !== previousHash) throw new Error(`PostgreSQL event integrity failure at ${event.id}.`);
      if (!validStoredEventHash(event)) throw new Error(`PostgreSQL event hash mismatch at ${event.id}.`);
      previousHash = event.eventHash;
    }
    this.initialized = true;
  }

  all(incidentId?: string) { return incidentId ? this.events.filter(event => event.incidentId === incidentId) : [...this.events]; }

  async append(input: Omit<IncidentDomainEvent, "id" | "occurredAt" | "schemaVersion" | "previousHash" | "eventHash">) {
    await this.initialize();
    let committed: IncidentDomainEvent | undefined;
    const operation = this.writeChain.then(async () => {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock($1)", [20488731]);
        const latest = await client.query<{ event_hash: string }>("SELECT event_hash FROM incident_events ORDER BY sequence_no DESC LIMIT 1");
        const hashable: Omit<IncidentDomainEvent, "eventHash"> = {
          id: crypto.randomUUID(), incidentId: input.incidentId, type: input.type,
          occurredAt: new Date().toISOString(), actorId: input.actorId,
          correlationId: input.correlationId, payload: JSON.parse(JSON.stringify(input.payload)),
          schemaVersion: 2, previousHash: latest.rows[0]?.event_hash || "GENESIS"
        };
        const event: IncidentDomainEvent = { ...hashable, eventHash: computedHash(hashable) };
        await client.query(`INSERT INTO incident_events
          (id, incident_id, event_type, occurred_at, actor_id, correlation_id, payload, schema_version, previous_hash, event_hash)
          VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)`,
          [event.id, event.incidentId, event.type, event.occurredAt, event.actorId, event.correlationId,
            JSON.stringify(event.payload), event.schemaVersion, event.previousHash, event.eventHash]);
        await client.query("COMMIT");
        this.events.push(event);
        committed = event;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    });
    this.writeChain = operation.catch(() => undefined);
    await operation;
    if (!committed) throw new Error("PostgreSQL incident event append did not commit.");
    return committed;
  }

  async close() { await this.pool.end(); }
}
