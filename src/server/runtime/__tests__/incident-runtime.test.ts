import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DurableIncidentEventStore } from "../../incident-runtime.ts";

async function withStore(run: (filePath: string, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloudzero-event-store-"));
  const filePath = path.join(root, "incident-events.jsonl");
  try {
    await run(filePath, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function input(index: number) {
  return {
    incidentId: "INC-CHAIN-1",
    type: "EvidenceObserved",
    actorId: "connector-test",
    correlationId: `correlation-${index}`,
    payload: { index, summary: `observation ${index}` }
  };
}

test("event appends are serialized into a verifiable hash chain", async () => {
  await withStore(async filePath => {
    const store = new DurableIncidentEventStore(filePath);
    const appended = await Promise.all([store.append(input(1)), store.append(input(2)), store.append(input(3))]);

    assert.equal(store.all().length, 3);
    assert.ok(appended.every(event => event.schemaVersion === 2 && /^[a-f0-9]{64}$/.test(event.eventHash || "")));
    const persisted = await readFile(filePath, "utf8");
    assert.equal(persisted.trim().split(/\r?\n/).length, 3);

    const restored = new DurableIncidentEventStore(filePath);
    await restored.initialize();
    assert.equal(restored.all().length, 3);
  });
});

test("initialization rejects a tampered hash-chained event", async () => {
  await withStore(async filePath => {
    const store = new DurableIncidentEventStore(filePath);
    await store.append(input(1));
    await store.append(input(2));

    const lines = (await readFile(filePath, "utf8")).trim().split(/\r?\n/);
    const second = JSON.parse(lines[1]);
    second.payload.summary = "tampered observation";
    lines[1] = JSON.stringify(second);
    await writeFile(filePath, `${lines.join("\n")}\n`, "utf8");

    const restored = new DurableIncidentEventStore(filePath);
    await assert.rejects(() => restored.initialize(), /event hash mismatch/);
  });
});
