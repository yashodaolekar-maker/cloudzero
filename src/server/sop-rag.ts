import crypto from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { KNOWLEDGE_INDEX_SCHEMA_VERSION, type DocumentKnowledgeStore, type KnowledgeManifest } from "./knowledge-index.ts";
import { buildKnowledgeChunk, chunkPageText, normalizeExtractedPageText } from "./knowledge-ingestion.ts";

const MAX_SOP_BYTES = 2 * 1024 * 1024;
const MAX_CHARACTERS = 1_600;
const OVERLAP_CHARACTERS = 180;

export interface SopDocumentInput { title: string; fileName: string; content: string }
export interface SopIncidentInput { incidentId?: string; title: string; description?: string; severity?: string; category?: string; evidence?: string[] }

function safeTitle(value: unknown) {
  return normalizeExtractedPageText(String(value || "")).slice(0, 240);
}

export async function ingestSopDocument(rootDirectory: string, input: SopDocumentInput) {
  const extension = path.extname(input.fileName || "").toLowerCase();
  if (![".md", ".txt"].includes(extension)) throw new Error("Only Markdown (.md) and text (.txt) SOP files are accepted.");
  const content = String(input.content || "");
  const bytes = Buffer.from(content, "utf8");
  if (!bytes.length || bytes.length > MAX_SOP_BYTES) throw new Error("SOP content must be non-empty and no larger than 2 MB.");
  const title = safeTitle(input.title || content.match(/^#\s+(.+)$/m)?.[1] || path.basename(input.fileName, extension));
  if (!title) throw new Error("A valid SOP title is required.");
  const sourceDocumentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const documentId = `doc-${sourceDocumentHash.slice(0, 20)}`;
  const sections = content.split(/^##\s+/m).map(normalizeExtractedPageText).filter(Boolean);
  const chunks = sections.flatMap((section, index) => chunkPageText(section, MAX_CHARACTERS, OVERLAP_CHARACTERS)
    .map(text => buildKnowledgeChunk({ documentId, documentTitle: title, sourceDocumentHash, pageNumber: index + 1, text })));
  if (!chunks.length) throw new Error("No indexable SOP content was found.");
  const manifest: KnowledgeManifest = {
    schemaVersion: KNOWLEDGE_INDEX_SCHEMA_VERSION, documentId, title,
    sourceFileName: path.basename(input.fileName), sourceDocumentHash,
    pageCount: sections.length, indexedPageCount: sections.length, chunkCount: chunks.length,
    generatedAt: new Date().toISOString(), chunking: { maxCharacters: MAX_CHARACTERS, overlapCharacters: OVERLAP_CHARACTERS }
  };
  await mkdir(rootDirectory, { recursive: true });
  const finalDirectory = path.join(rootDirectory, documentId);
  try {
    const existing = JSON.parse(await readFile(path.join(finalDirectory, "manifest.json"), "utf8")) as KnowledgeManifest;
    if (existing.sourceDocumentHash === sourceDocumentHash) return { status: "already_indexed" as const, manifest: existing };
  } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  const temporaryDirectory = path.join(rootDirectory, `.${documentId}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  await mkdir(temporaryDirectory);
  try {
    await Promise.all([
      writeFile(path.join(temporaryDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" }),
      writeFile(path.join(temporaryDirectory, "chunks.jsonl"), `${chunks.map(chunk => JSON.stringify(chunk)).join("\n")}\n`, { flag: "wx" })
    ]);
    await rename(temporaryDirectory, finalDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  return { status: "indexed" as const, manifest };
}

function verificationSentences(excerpt: string) {
  const marked = [...excerpt.matchAll(/\[VERIFY\]\s*([^[]+?)(?=\s*\[(?:VERIFY|STOP|ESCALATE|ROLLBACK)\]|$)/gi)].map(match => match[1]);
  const candidates = marked.length ? marked : excerpt.split(/(?<=[.!?;])\s+/).filter(sentence => /\b(?:verify|validate|confirm|compare|inspect|review|check|test)\b/i.test(sentence));
  return candidates.map(value => normalizeExtractedPageText(value).replace(/^[-*\d.)\s]+/, "").slice(0, 500)).filter(value => value.length >= 12);
}

export function buildSopVerificationPlan(store: DocumentKnowledgeStore, incident: SopIncidentInput) {
  const query = [incident.title, incident.description, incident.category, ...(incident.evidence || [])].filter(Boolean).join(" ").slice(0, 2_000);
  const retrieved = store.search(query, 6, true);
  const strongestScore = retrieved[0]?.citation.score || 0;
  const matches = retrieved.filter(match => match.citation.score >= Math.max(4, strongestScore * 0.55));
  const checks = [...new Set(matches.flatMap(match => verificationSentences(match.excerpt)))].slice(0, 10);
  return {
    incidentId: incident.incidentId || null,
    groundingStatus: matches.length && checks.length ? "GROUNDED" as const : "ABSTAINED" as const,
    severity: incident.severity || "UNKNOWN",
    verificationChecks: checks.map((check, index) => ({ id: `SOP-CHECK-${index + 1}`, check, status: "PENDING" as const })),
    citations: matches.map(match => match.citation),
    retrievedPassages: matches.map(match => match.excerpt),
    actionBlocked: true,
    limitations: matches.length
      ? ["SOP retrieval guides read-only verification only; it does not prove current state or authorize remediation."]
      : ["No approved SOP passage matched this incident. Escalate to the owning SME before proposing remediation."]
  };
}
