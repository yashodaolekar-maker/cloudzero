import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { IncidentLifecycleState, OperatingMode } from "../types.ts";

export interface IncidentDomainEvent<T = Record<string, unknown>> {
  id: string;
  incidentId: string;
  type: string;
  occurredAt: string;
  actorId: string;
  correlationId: string;
  payload: T;
  /** Present on newly persisted events; legacy JSONL records remain readable. */
  schemaVersion?: 2;
  /** SHA-256 hash of the immediately preceding persisted record or GENESIS. */
  previousHash?: string;
  /** SHA-256 of this canonical event record, excluding eventHash itself. */
  eventHash?: string;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined && typeof item !== "function" && typeof item !== "symbol")
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, canonicalize(item)])
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
}

function sha256(value: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(canonicalize(value)), "utf8").digest("hex");
}

function legacyAnchor(event: IncidentDomainEvent) {
  return sha256(event);
}

function computedEventHash(event: Omit<IncidentDomainEvent, "eventHash">) {
  return sha256(event);
}

const allowedTransitions: Record<IncidentLifecycleState, IncidentLifecycleState[]> = {
  DETECTED: ["TRIAGED", "MAJOR_INCIDENT_DECLARED"],
  TRIAGED: ["MAJOR_INCIDENT_DECLARED", "INVESTIGATING", "RESOLVED"],
  MAJOR_INCIDENT_DECLARED: ["INVESTIGATING"],
  INVESTIGATING: ["MITIGATION_PROPOSED", "RESOLVED"],
  MITIGATION_PROPOSED: ["AWAITING_APPROVAL", "INVESTIGATING"],
  AWAITING_APPROVAL: ["EXECUTING", "MITIGATION_PROPOSED"],
  EXECUTING: ["VERIFYING", "MITIGATION_PROPOSED"],
  VERIFYING: ["MONITORING", "MITIGATION_PROPOSED"],
  MONITORING: ["RESOLVED", "INVESTIGATING"],
  RESOLVED: ["POSTMORTEM", "INVESTIGATING"],
  POSTMORTEM: []
};

export function assertLifecycleTransition(from: IncidentLifecycleState, to: IncidentLifecycleState) {
  if (from === to) return;
  if (!allowedTransitions[from].includes(to)) {
    throw new Error(`Invalid incident lifecycle transition: ${from} -> ${to}`);
  }
}

export class DurableIncidentEventStore {
  private events: IncidentDomainEvent[] = [];
  private initialized = false;
  private writeChain = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async initialize() {
    if (this.initialized) return;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const contents = await readFile(this.filePath, "utf8");
      this.events = contents.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
      let previous: IncidentDomainEvent | undefined;
      let hashChainStarted = false;
      for (const event of this.events) {
        if (!event.eventHash) {
          if (hashChainStarted) throw new Error(`Incident event integrity failure: unhashed event ${event.id} follows the hash chain.`);
          previous = event;
          continue;
        }
        hashChainStarted = true;
        const expectedPreviousHash = previous ? previous.eventHash || legacyAnchor(previous) : "GENESIS";
        if (event.previousHash !== expectedPreviousHash) {
          throw new Error(`Incident event integrity failure: previous hash mismatch at event ${event.id}.`);
        }
        const { eventHash, ...hashable } = event;
        if (eventHash !== computedEventHash(hashable)) {
          throw new Error(`Incident event integrity failure: event hash mismatch at event ${event.id}.`);
        }
        previous = event;
      }
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.initialized = true;
  }

  all(incidentId?: string) {
    return incidentId ? this.events.filter(event => event.incidentId === incidentId) : [...this.events];
  }

  async append(input: Omit<IncidentDomainEvent, "id" | "occurredAt" | "schemaVersion" | "previousHash" | "eventHash">) {
    await this.initialize();
    let committedEvent: IncidentDomainEvent | undefined;
    const commit = this.writeChain.then(async () => {
      const previous = this.events.at(-1);
      const hashable: Omit<IncidentDomainEvent, "eventHash"> = {
        id: crypto.randomUUID(),
        incidentId: input.incidentId,
        type: input.type,
        occurredAt: new Date().toISOString(),
        actorId: input.actorId,
        correlationId: input.correlationId,
        payload: input.payload,
        schemaVersion: 2,
        previousHash: previous ? previous.eventHash || legacyAnchor(previous) : "GENESIS"
      };
      const event: IncidentDomainEvent = {
        ...hashable,
        eventHash: computedEventHash(hashable)
      };
      // Update the in-memory view only after the append is durable.
      await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
      this.events.push(event);
      committedEvent = event;
    });
    this.writeChain = commit.catch(() => undefined);
    await commit;
    if (!committedEvent) throw new Error("Incident event append did not commit.");
    return committedEvent;
  }
}

export class IncidentEventBus {
  private subscribers = new Set<(event: IncidentDomainEvent) => void>();

  subscribe(listener: (event: IncidentDomainEvent) => void) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  publish(event: IncidentDomainEvent) {
    for (const listener of this.subscribers) listener(event);
  }
}

export function runtimeMode(): OperatingMode {
  return process.env.OPERATING_MODE === "LIVE" ? "LIVE" : "SIMULATION";
}
