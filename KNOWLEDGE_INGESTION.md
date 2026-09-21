# Grounded document knowledge

CloudZero uses retrieval, not model fine-tuning, for operational documents. This keeps the original source, page number, document hash, chunk hash, and abstention decision visible for every answer. Document text is always treated as untrusted data; instructions found inside a PDF cannot change agent policy, authorize tools, or execute remediation.

## Ingest a PDF locally

```powershell
npm run knowledge:ingest -- "C:\path\to\guide.pdf" ".data\knowledge" "Approved document title"
```

The command:

1. reads the PDF locally with Mozilla PDF.js;
2. calculates a SHA-256 hash of the original file;
3. extracts text per page without OCR or external API calls;
4. creates bounded overlapping chunks that never cross page boundaries;
5. hashes every chunk and writes an immutable document-specific index directory atomically.

Re-ingesting the same file is idempotent. The original PDF is not copied into the repository or container image.

## Query the index

```text
GET  /api/knowledge/status
GET  /api/knowledge/search?q=BGP%20best%20path
POST /api/knowledge/answer
     { "question": "How does BGP best-path selection work?" }
```

Responses include `groundingStatus`, page-level citations, document and chunk integrity hashes, limitations, and `actionBlocked`. Operational instructions are reference-only; retrieval never authorizes or executes a device change. If sufficiently specific passages are not found, the API returns `ABSTAINED` rather than using model memory.

The hardened voice agent uses this index for general networking questions. Incident-specific questions continue to use only the selected incident aggregate and its persisted evidence.

## Ingest a curated Markdown runbook

Version-controlled operational runbooks can use the same immutable index contract:

```powershell
npm run knowledge:ingest-markdown -- "knowledge-packs\network-sdwan-zscaler.md" ".data\knowledge"
```

Markdown ingestion accepts `.md` and `.txt` files up to 2 MB, treats each level-two section as a citation page, and records the source and chunk SHA-256 hashes. Keep source URLs, owner, applicability and review cycle in each runbook. Restart the application after adding documents so its in-memory index reloads them.

## Current CCIE guide index

The supplied *CCIE Routing and Switching Certification Guide, Fourth Edition* was indexed locally as:

- document ID: `doc-d19ab4abeabd1f33f4b9`;
- source SHA-256: `d19ab4abeabd1f33f4b9069e5bb4c78e1f7faed91519e54d2ee736c177404b02`;
- PDF pages: 1,347;
- pages with extractable text: 1,338;
- chunks: 2,552.

Nine pages had no extractable text. They remain unavailable unless a separately reviewed OCR pipeline is added. Treat certification material as conceptual/reference knowledge: validate commands against current vendor documentation, the actual platform release, the exact device state, and an approved internal runbook before making a recommendation.

## Production follow-up

- Add document ownership, classification, license, review date, product/version applicability, and expiry metadata.
- Require security scanning and approval before indexing new documents.
- Replace the local lexical index with an approved managed retrieval service when multi-replica deployment is introduced, while preserving the same citation and integrity contract.
- Add a curated answer layer that summarizes only cited passages and is evaluated against golden questions. Generative summaries must never enter the execution control path.
- Re-index when the source hash or chunking schema changes; do not silently mix editions.
