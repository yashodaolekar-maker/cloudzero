import crypto from "node:crypto";
import {
  KNOWLEDGE_INDEX_SCHEMA_VERSION,
  knowledgeChunkIntegrity,
  type KnowledgeChunk
} from "./knowledge-index.ts";

export function normalizeExtractedPageText(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function chunkPageText(text: string, maxCharacters = 1_600, overlapCharacters = 180) {
  const normalized = normalizeExtractedPageText(text);
  const max = Math.max(500, Math.min(maxCharacters, 4_000));
  const overlap = Math.max(0, Math.min(overlapCharacters, Math.floor(max / 4)));
  if (!normalized) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    let end = Math.min(normalized.length, start + max);
    if (end < normalized.length) {
      const candidate = normalized.slice(start + Math.floor(max * 0.6), end);
      const boundary = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("\n"), candidate.lastIndexOf("; "));
      if (boundary >= 0) end = start + Math.floor(max * 0.6) + boundary + 1;
    }
    const chunk = normalizeExtractedPageText(normalized.slice(start, end));
    if (chunk.length >= 20) chunks.push(chunk);
    if (end >= normalized.length) break;
    const next = Math.max(start + 1, end - overlap);
    start = next;
  }
  return chunks;
}

export function buildKnowledgeChunk(input: {
  documentId: string;
  documentTitle: string;
  sourceDocumentHash: string;
  pageNumber: number;
  text: string;
}): KnowledgeChunk {
  const base = {
    schemaVersion: KNOWLEDGE_INDEX_SCHEMA_VERSION,
    documentId: input.documentId,
    documentTitle: input.documentTitle,
    sourceDocumentHash: input.sourceDocumentHash,
    pageStart: input.pageNumber,
    pageEnd: input.pageNumber,
    text: normalizeExtractedPageText(input.text)
  };
  const integrityHash = knowledgeChunkIntegrity(base);
  return {
    ...base,
    id: `chunk-${crypto.createHash("sha256").update(`${integrityHash}\u0000${input.pageNumber}`, "utf8").digest("hex").slice(0, 20)}`,
    integrityHash
  };
}
