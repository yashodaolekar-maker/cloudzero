import crypto from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const KNOWLEDGE_INDEX_SCHEMA_VERSION = 1 as const;

export interface KnowledgeManifest {
  schemaVersion: typeof KNOWLEDGE_INDEX_SCHEMA_VERSION;
  documentId: string;
  title: string;
  sourceFileName: string;
  sourceDocumentHash: string;
  pageCount: number;
  indexedPageCount: number;
  chunkCount: number;
  generatedAt: string;
  chunking: { maxCharacters: number; overlapCharacters: number };
}

export interface KnowledgeChunk {
  schemaVersion: typeof KNOWLEDGE_INDEX_SCHEMA_VERSION;
  id: string;
  documentId: string;
  documentTitle: string;
  sourceDocumentHash: string;
  pageStart: number;
  pageEnd: number;
  text: string;
  integrityHash: string;
}

export interface KnowledgeCitation {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  pageStart: number;
  pageEnd: number;
  integrityHash: string;
  sourceDocumentHash: string;
  score: number;
}

export interface KnowledgeSearchResult {
  excerpt: string;
  citation: KnowledgeCitation;
}

export interface DocumentGroundedAnswer {
  text: string;
  groundingStatus: "GROUNDED" | "ABSTAINED";
  citations: KnowledgeCitation[];
  limitations: string[];
  actionBlocked: boolean;
}

const STOP_WORDS = new Set([
  "about", "after", "also", "and", "are", "can", "could", "does", "for", "from", "have", "how", "into",
  "please", "should", "that", "the", "their", "then", "there", "these", "they", "this", "what", "when",
  "where", "which", "with", "would", "you", "your", "why", "is", "was", "were", "my", "our", "it"
]);

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function terms(value: string) {
  return [...new Set(cleanText(value, 2_000).toLowerCase().match(/[a-z0-9][a-z0-9./:_-]{1,}/g) || [])]
    .filter(term => !STOP_WORDS.has(term));
}

export function knowledgeChunkIntegrity(input: Pick<KnowledgeChunk, "documentId" | "sourceDocumentHash" | "pageStart" | "pageEnd" | "text">) {
  return crypto.createHash("sha256").update([
    input.documentId,
    input.sourceDocumentHash,
    String(input.pageStart),
    String(input.pageEnd),
    input.text
  ].join("\u0000"), "utf8").digest("hex");
}

function actionIntent(question: string) {
  return /\b(?:execute|apply|deploy|restart|reboot|patch|disable|delete|configure|change|modify|reroute|shutdown|shut down)\b/i.test(question);
}

function navigationLike(text: string) {
  const markers = text.match(/\b(?:chapter|foundation topics|foundation summary|memory builders|definitions|further reading|contents)\b/gi) || [];
  const pageNumberPairs = text.match(/\b[A-Za-z][A-Za-z -]{3,60}\s\d{1,4}\b/g) || [];
  return markers.length >= 4 && pageNumberPairs.length >= 6;
}

function extractionNoise(text: string) {
  const words = cleanText(text, 5_000).split(/\s+/).filter(Boolean);
  if (words.length < 20) return false;
  const singleCharacterTokens = words.filter(word => /^[a-z0-9]$/i.test(word)).length;
  return singleCharacterTokens / words.length > 0.16;
}

function focusedExcerpt(text: string, queryTerms: string[]) {
  const sentences = cleanText(text, 5_000).split(/(?<=[.!?])\s+/).filter(sentence => sentence.length >= 24);
  const selected = sentences
    .map((sentence, index) => {
      const sentenceTerms = new Set(terms(sentence));
      return { sentence, index, matches: queryTerms.filter(term => sentenceTerms.has(term)).length };
    })
    .filter(item => item.matches > 0)
    .sort((left, right) => right.matches - left.matches || left.index - right.index)
    .slice(0, 3)
    .sort((left, right) => left.index - right.index)
    .map(item => item.sentence)
    .join(" ");
  return cleanText(selected || text, 700);
}

export class DocumentKnowledgeStore {
  private chunks: KnowledgeChunk[] = [];
  private indexedChunks: Array<{ chunk: KnowledgeChunk; terms: Set<string> }> = [];
  private manifests: KnowledgeManifest[] = [];

  get status() {
    return {
      documents: this.manifests.map(item => ({
        documentId: item.documentId,
        title: item.title,
        sourceDocumentHash: item.sourceDocumentHash,
        pageCount: item.pageCount,
        chunkCount: item.chunkCount
      })),
      chunkCount: this.chunks.length
    };
  }

  async load(rootDirectory: string) {
    this.chunks = [];
    this.indexedChunks = [];
    this.manifests = [];
    let directories: string[] = [];
    try {
      directories = (await readdir(rootDirectory, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(rootDirectory, entry.name));
    } catch (error: any) {
      if (error?.code === "ENOENT") return this.status;
      throw error;
    }

    for (const directory of directories.sort()) {
      const manifestPath = path.join(directory, "manifest.json");
      const chunksPath = path.join(directory, "chunks.jsonl");
      let manifest: KnowledgeManifest;
      let chunkContents: string;
      try {
        const [manifestContents, contents] = await Promise.all([
          readFile(manifestPath, "utf8"),
          readFile(chunksPath, "utf8")
        ]);
        manifest = JSON.parse(manifestContents) as KnowledgeManifest;
        chunkContents = contents;
      } catch (error: any) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (manifest.schemaVersion !== KNOWLEDGE_INDEX_SCHEMA_VERSION || !/^[a-f0-9]{64}$/.test(manifest.sourceDocumentHash)) {
        throw new Error(`Knowledge manifest is invalid in ${directory}.`);
      }
      if (Buffer.byteLength(chunkContents, "utf8") > 100 * 1024 * 1024) throw new Error(`Knowledge index exceeds the 100 MB limit in ${directory}.`);
      const loaded = chunkContents.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as KnowledgeChunk);
      if (loaded.length !== manifest.chunkCount || loaded.length > 50_000) throw new Error(`Knowledge chunk count mismatch in ${directory}.`);
      for (const chunk of loaded) {
        const valid =
          chunk.schemaVersion === KNOWLEDGE_INDEX_SCHEMA_VERSION &&
          chunk.documentId === manifest.documentId &&
          chunk.documentTitle === manifest.title &&
          chunk.sourceDocumentHash === manifest.sourceDocumentHash &&
          Number.isInteger(chunk.pageStart) && chunk.pageStart >= 1 &&
          Number.isInteger(chunk.pageEnd) && chunk.pageEnd >= chunk.pageStart &&
          cleanText(chunk.text, 20_000) === chunk.text &&
          chunk.text.length >= 20 && chunk.text.length <= 5_000 &&
          chunk.integrityHash === knowledgeChunkIntegrity(chunk);
        if (!valid) throw new Error(`Knowledge chunk integrity validation failed for ${chunk.id || "unknown"}.`);
      }
      this.manifests.push(manifest);
      this.chunks.push(...loaded);
      this.indexedChunks.push(...loaded.map(chunk => ({ chunk, terms: new Set(terms(`${chunk.documentTitle} ${chunk.text}`)) })));
    }
    return this.status;
  }

  search(query: string, limit = 4, completePassage = false): KnowledgeSearchResult[] {
    const queryTerms = terms(query).slice(0, 24);
    if (!queryTerms.length || !this.chunks.length) return [];
    const navigationRequested = /\b(?:chapter|contents|section|page|where in the (?:book|guide))\b/i.test(query);
    const documentFrequency = new Map<string, number>();
    for (const queryTerm of queryTerms) {
      documentFrequency.set(queryTerm, this.indexedChunks.filter(item => item.terms.has(queryTerm)).length);
    }
    const minimumOverlap = queryTerms.length >= 3 ? 2 : 1;
    return this.indexedChunks
      .map(({ chunk, terms: chunkTerms }) => {
        const matched = queryTerms.filter(term => chunkTerms.has(term));
        const score = matched.reduce((total, term) => total + Math.log((this.chunks.length + 1) / ((documentFrequency.get(term) || 0) + 1)) + 1, 0)
          + (matched.length / queryTerms.length) * 2;
        return { chunk, matched, score };
      })
      .filter(item => item.matched.length >= minimumOverlap)
      .filter(item => navigationRequested || !navigationLike(item.chunk.text))
      .filter(item => !extractionNoise(item.chunk.text))
      .sort((left, right) => right.score - left.score || left.chunk.pageStart - right.chunk.pageStart || left.chunk.id.localeCompare(right.chunk.id))
      .slice(0, Math.max(1, Math.min(limit, 6)))
      .map(item => ({
        excerpt: completePassage ? cleanText(item.chunk.text, 5_000) : focusedExcerpt(item.chunk.text, queryTerms),
        citation: {
          documentId: item.chunk.documentId,
          documentTitle: item.chunk.documentTitle,
          chunkId: item.chunk.id,
          pageStart: item.chunk.pageStart,
          pageEnd: item.chunk.pageEnd,
          integrityHash: item.chunk.integrityHash,
          sourceDocumentHash: item.chunk.sourceDocumentHash,
          score: Number(item.score.toFixed(4))
        }
      }));
  }

  answer(question: string): DocumentGroundedAnswer {
    const cleanQuestion = cleanText(question, 600);
    const results = this.search(cleanQuestion, 2);
    const blocked = actionIntent(cleanQuestion);
    if (!results.length) {
      return {
        text: "I cannot answer that question from the indexed documents because no sufficiently specific passage matched.",
        groundingStatus: "ABSTAINED",
        citations: [],
        limitations: ["No model knowledge or fuzzy generative fallback was used."],
        actionBlocked: blocked
      };
    }
    const text = results.map(result => {
      const pages = result.citation.pageStart === result.citation.pageEnd
        ? `page ${result.citation.pageStart}`
        : `pages ${result.citation.pageStart}-${result.citation.pageEnd}`;
      return `[${result.citation.documentTitle}, ${pages}, ${result.citation.chunkId}] ${result.excerpt}`;
    }).join("\n\n");
    return {
      text: `${text}${blocked ? "\n\nReference only: this retrieval did not authorize or execute a device change." : ""}`,
      groundingStatus: "GROUNDED",
      citations: results.map(result => result.citation),
      limitations: ["Answer is extractive and limited to the indexed passages; validate commands against the current vendor release and approved runbook."],
      actionBlocked: blocked
    };
  }
}
