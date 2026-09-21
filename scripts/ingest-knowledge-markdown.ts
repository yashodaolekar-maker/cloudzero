import crypto from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_INDEX_SCHEMA_VERSION, type KnowledgeManifest } from "../src/server/knowledge-index.ts";
import { buildKnowledgeChunk, chunkPageText, normalizeExtractedPageText } from "../src/server/knowledge-ingestion.ts";

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_CHARACTERS = 1_600;
const OVERLAP_CHARACTERS = 180;

async function main() {
  const inputArgument = process.argv[2];
  if (!inputArgument) throw new Error("Usage: npm run knowledge:ingest-markdown -- <markdown-path> [output-root] [document-title]");
  const inputPath = path.resolve(inputArgument);
  if (!new Set([".md", ".txt"]).has(path.extname(inputPath).toLowerCase())) throw new Error("Only Markdown or text runbooks are accepted.");
  const outputRoot = path.resolve(process.argv[3] || path.join(".data", "knowledge"));
  const bytes = await readFile(inputPath);
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("Runbook must be non-empty and no larger than 2 MB.");
  const sourceDocumentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const documentId = `doc-${sourceDocumentHash.slice(0, 20)}`;
  const raw = bytes.toString("utf8");
  const heading = raw.match(/^#\s+(.+)$/m)?.[1];
  const documentTitle = normalizeExtractedPageText(process.argv[4] || heading || path.basename(inputPath, path.extname(inputPath))).slice(0, 240);
  const sections = raw.split(/^##\s+/m).map(value => normalizeExtractedPageText(value)).filter(Boolean);
  const chunks = sections.flatMap((section, index) => chunkPageText(section, MAX_CHARACTERS, OVERLAP_CHARACTERS)
    .map(text => buildKnowledgeChunk({ documentId, documentTitle, sourceDocumentHash, pageNumber: index + 1, text })));
  if (!chunks.length) throw new Error("No indexable runbook content was found.");
  const manifest: KnowledgeManifest = { schemaVersion: KNOWLEDGE_INDEX_SCHEMA_VERSION, documentId, title: documentTitle,
    sourceFileName: path.basename(inputPath), sourceDocumentHash, pageCount: sections.length, indexedPageCount: sections.length,
    chunkCount: chunks.length, generatedAt: new Date().toISOString(), chunking: { maxCharacters: MAX_CHARACTERS, overlapCharacters: OVERLAP_CHARACTERS } };
  await mkdir(outputRoot, { recursive: true });
  const finalDirectory = path.join(outputRoot, documentId);
  try {
    const existing = JSON.parse(await readFile(path.join(finalDirectory, "manifest.json"), "utf8")) as KnowledgeManifest;
    if (existing.sourceDocumentHash === sourceDocumentHash) { console.log(JSON.stringify({ status: "already_indexed", ...existing })); return; }
  } catch (error: any) { if (error?.code !== "ENOENT") throw error; }
  const temporaryDirectory = path.join(outputRoot, `.${documentId}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  await mkdir(temporaryDirectory);
  try {
    await Promise.all([
      writeFile(path.join(temporaryDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" }),
      writeFile(path.join(temporaryDirectory, "chunks.jsonl"), `${chunks.map(chunk => JSON.stringify(chunk)).join("\n")}\n`, { flag: "wx" })
    ]);
    await rename(temporaryDirectory, finalDirectory);
  } catch (error) { await rm(temporaryDirectory, { recursive: true, force: true }); throw error; }
  console.log(JSON.stringify({ status: "indexed", outputDirectory: finalDirectory, ...manifest }));
}
main().catch(error => { console.error(`Knowledge ingestion failed: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
