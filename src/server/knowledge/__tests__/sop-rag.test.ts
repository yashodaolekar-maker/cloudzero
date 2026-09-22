import assert from "node:assert/strict";
import test from "node:test";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { DocumentKnowledgeStore } from "../../knowledge-index.ts";
import { buildSopVerificationPlan, ingestSopDocument } from "../../sop-rag.ts";

test("attached SOP is indexed, cited, and converted into a bounded verification plan", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloudzero-sop-rag-"));
  try {
    const first = await ingestSopDocument(root, {
      title: "Wireless roaming SOP",
      fileName: "wireless-roaming.md",
      content: "# Wireless roaming SOP\n\n## Session loss\n[VERIFY] Measure roaming handoff interruption and session continuity. [VERIFY] Confirm authentication remains available. [STOP] Do not change the RF profile from one report."
    });
    assert.equal(first.status, "indexed");
    const duplicate = await ingestSopDocument(root, { title: "Wireless roaming SOP", fileName: "wireless-roaming.md", content: "# Wireless roaming SOP\n\n## Session loss\n[VERIFY] Measure roaming handoff interruption and session continuity. [VERIFY] Confirm authentication remains available. [STOP] Do not change the RF profile from one report." });
    assert.equal(duplicate.status, "already_indexed");
    const store = new DocumentKnowledgeStore();
    await store.load(root);
    const plan = buildSopVerificationPlan(store, { title: "Wireless clients lose their session while roaming", severity: "P1 - Critical" });
    assert.equal(plan.groundingStatus, "GROUNDED");
    assert.equal(plan.actionBlocked, true);
    assert.ok(plan.verificationChecks.some(item => /handoff interruption/i.test(item.check)));
    assert.ok(plan.citations.every(item => item.documentId === first.manifest.documentId));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verification planner abstains when no SOP matches", () => {
  const plan = buildSopVerificationPlan(new DocumentKnowledgeStore(), { title: "Unknown flux incident" });
  assert.equal(plan.groundingStatus, "ABSTAINED");
  assert.deepEqual(plan.verificationChecks, []);
  assert.equal(plan.actionBlocked, true);
});
