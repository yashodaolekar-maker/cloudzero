import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { DocumentKnowledgeStore, KNOWLEDGE_INDEX_SCHEMA_VERSION, type KnowledgeManifest } from "../../knowledge-index.ts";
import { buildKnowledgeChunk, chunkPageText } from "../../knowledge-ingestion.ts";

const documentHash = "a".repeat(64);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloudzero-knowledge-"));
  const documentId = "doc-test-guide";
  const directory = path.join(root, documentId);
  await mkdir(directory);
  const source = [
    buildKnowledgeChunk({
      documentId,
      documentTitle: "Routing Guide",
      sourceDocumentHash: documentHash,
      pageNumber: 42,
      text: "BGP best-path selection evaluates path attributes. Local preference is evaluated before AS path length in this source passage."
    }),
    buildKnowledgeChunk({
      documentId,
      documentTitle: "Routing Guide",
      sourceDocumentHash: documentHash,
      pageNumber: 77,
      text: "OSPF neighbors exchange hello packets and must agree on key parameters before reaching full adjacency."
    })
  ];
  const manifest: KnowledgeManifest = {
    schemaVersion: KNOWLEDGE_INDEX_SCHEMA_VERSION,
    documentId,
    title: "Routing Guide",
    sourceFileName: "guide.pdf",
    sourceDocumentHash: documentHash,
    pageCount: 100,
    indexedPageCount: 2,
    chunkCount: source.length,
    generatedAt: "2026-09-05T00:00:00.000Z",
    chunking: { maxCharacters: 1600, overlapCharacters: 180 }
  };
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest), "utf8");
  await writeFile(path.join(directory, "chunks.jsonl"), source.map(item => JSON.stringify(item)).join("\n") + "\n", "utf8");
  return { root, directory, source };
}

test("page chunking is bounded and overlapping", () => {
  const text = `${"Routing protocols exchange state. ".repeat(80)}End of page.`;
  const chunks = chunkPageText(text, 600, 100);
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 600 && chunk.length >= 20));
  assert.ok(chunks[0].split(" ").some(word => chunks[1].includes(word)));
});

test("retrieval returns only matching page-cited chunks", async () => {
  const { root } = await fixture();
  try {
    const store = new DocumentKnowledgeStore();
    const status = await store.load(root);
    assert.equal(status.chunkCount, 2);
    const results = store.search("How does BGP best path selection use local preference?", 3);
    assert.equal(results.length, 1);
    assert.equal(results[0].citation.pageStart, 42);
    assert.match(results[0].excerpt, /Local preference/);
    assert.match(results[0].citation.integrityHash, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("unknown questions abstain without model fallback", async () => {
  const { root } = await fixture();
  try {
    const store = new DocumentKnowledgeStore();
    await store.load(root);
    const answer = store.answer("Explain quantum gravity and baking temperatures");
    assert.equal(answer.groundingStatus, "ABSTAINED");
    assert.equal(answer.citations.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("operational instructions remain reference-only", async () => {
  const { root } = await fixture();
  try {
    const store = new DocumentKnowledgeStore();
    await store.load(root);
    const answer = store.answer("Configure BGP local preference and path selection");
    assert.equal(answer.groundingStatus, "GROUNDED");
    assert.equal(answer.actionBlocked, true);
    assert.match(answer.text, /Reference only/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("tampered chunks fail closed during load", async () => {
  const { root, directory, source } = await fixture();
  try {
    const tampered = { ...source[0], text: `${source[0].text} malicious unverified addition` };
    await writeFile(path.join(directory, "chunks.jsonl"), `${JSON.stringify(tampered)}\n${JSON.stringify(source[1])}\n`, "utf8");
    await assert.rejects(() => new DocumentKnowledgeStore().load(root), /integrity validation failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
