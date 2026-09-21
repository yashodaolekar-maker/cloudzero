import crypto from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { KNOWLEDGE_INDEX_SCHEMA_VERSION, type KnowledgeManifest } from "../src/server/knowledge-index.ts";
import { buildKnowledgeChunk, chunkPageText, normalizeExtractedPageText } from "../src/server/knowledge-ingestion.ts";

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_PAGES = 2_000;
const MAX_CHARACTERS = 1_600;
const OVERLAP_CHARACTERS = 180;

function safeTitle(value: unknown, fallback: string) {
  const normalized = normalizeExtractedPageText(String(value || fallback)).slice(0, 240);
  return normalized || fallback;
}

async function main() {
  const inputArgument = process.argv[2];
  if (!inputArgument) throw new Error("Usage: npm run knowledge:ingest -- <pdf-path> [output-root] [document-title]");
  const inputPath = path.resolve(inputArgument);
  if (path.extname(inputPath).toLowerCase() !== ".pdf") throw new Error("Knowledge ingestion accepts PDF files only.");
  const outputRoot = path.resolve(process.argv[3] || path.join(".data", "knowledge"));
  const requestedTitle = process.argv[4];
  const bytes = await readFile(inputPath);
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) throw new Error("PDF must be non-empty and no larger than 100 MB.");
  const sourceDocumentHash = crypto.createHash("sha256").update(bytes).digest("hex");
  const documentId = `doc-${sourceDocumentHash.slice(0, 20)}`;

  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: true
  });
  const document = await loadingTask.promise;
  try {
    if (document.numPages < 1 || document.numPages > MAX_PAGES) throw new Error(`PDF page count ${document.numPages} is outside the supported range.`);
    const metadata = await document.getMetadata().catch(() => null);
    const metadataTitle = metadata && "Title" in metadata.info ? metadata.info.Title : undefined;
    const documentTitle = safeTitle(requestedTitle || metadataTitle, path.basename(inputPath, path.extname(inputPath)));
    const chunks = [];
    let indexedPageCount = 0;

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const pageText = content.items.map(item => {
          if (!("str" in item)) return "";
          return `${item.str}${item.hasEOL ? "\n" : " "}`;
        }).join("");
        const pageChunks = chunkPageText(pageText, MAX_CHARACTERS, OVERLAP_CHARACTERS);
        if (pageChunks.length) indexedPageCount += 1;
        for (const text of pageChunks) {
          chunks.push(buildKnowledgeChunk({ documentId, documentTitle, sourceDocumentHash, pageNumber, text }));
        }
      } finally {
        page.cleanup();
      }
    }

    if (!chunks.length) throw new Error("No extractable text was found. OCR is required for image-only PDFs and is intentionally not performed automatically.");
    const manifest: KnowledgeManifest = {
      schemaVersion: KNOWLEDGE_INDEX_SCHEMA_VERSION,
      documentId,
      title: documentTitle,
      sourceFileName: path.basename(inputPath),
      sourceDocumentHash,
      pageCount: document.numPages,
      indexedPageCount,
      chunkCount: chunks.length,
      generatedAt: new Date().toISOString(),
      chunking: { maxCharacters: MAX_CHARACTERS, overlapCharacters: OVERLAP_CHARACTERS }
    };

    await mkdir(outputRoot, { recursive: true });
    const finalDirectory = path.join(outputRoot, documentId);
    try {
      const existing = JSON.parse(await readFile(path.join(finalDirectory, "manifest.json"), "utf8")) as KnowledgeManifest;
      if (existing.sourceDocumentHash === sourceDocumentHash && existing.schemaVersion === KNOWLEDGE_INDEX_SCHEMA_VERSION) {
        console.log(JSON.stringify({ status: "already_indexed", outputDirectory: finalDirectory, ...existing }));
        return;
      }
      throw new Error(`A different index already exists at ${finalDirectory}.`);
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }

    const temporaryDirectory = path.join(outputRoot, `.${documentId}-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
    await mkdir(temporaryDirectory, { recursive: false });
    try {
      await Promise.all([
        writeFile(path.join(temporaryDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" }),
        writeFile(path.join(temporaryDirectory, "chunks.jsonl"), `${chunks.map(chunk => JSON.stringify(chunk)).join("\n")}\n`, { encoding: "utf8", flag: "wx" })
      ]);
      await rename(temporaryDirectory, finalDirectory);
    } catch (error) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }

    console.log(JSON.stringify({ status: "indexed", outputDirectory: finalDirectory, ...manifest }));
  } finally {
    await loadingTask.destroy();
  }
}

main().catch(error => {
  console.error(`Knowledge ingestion failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
