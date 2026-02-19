---
summary: "Document upload, processing, linking, and RAG retrieval architecture."
read_when:
  - You are implementing document ingestion
  - You are debugging document indexing or retrieval answers
title: "Documents and RAG"
---

# Documents and RAG

## Scope

This feature adds a document workspace with:

- file upload (`/api/documents/upload`)
- async extraction, chunking, embedding, and analysis
- company/contact link confirmation
- question-answering over indexed chunks (`/api/documents/ask`)

## Storage Model

- Raw files:
  - local filesystem path under `DOCUMENT_STORAGE_PATH` when `DOCUMENT_STORAGE_BACKEND=local`
  - S3 object key when `DOCUMENT_STORAGE_BACKEND=s3`
- Metadata/index:
  - SQLite `documents`, `document_chunks`, `document_contacts`
  - mirrored semantic index in `semantic_chunks` + `semantic_embeddings` (`source_type='file_chunk'`)
- Embeddings:
  - stored as `BLOB` in `document_chunks.embedding`

## Processing Lifecycle

Document status transitions:

`pending -> extracting -> chunking -> embedding -> analyzing -> ready`

On errors:

`* -> failed` with `status_message`.

Quality guardrails:

- Upload-time document analysis is LLM-first and uses `DOCUMENT_ANALYSIS_MODEL` (default `gpt-4o-mini`) when `OPENAI_API_KEY` is configured.
  - If the model call fails (timeout/connection error), processing falls back to local heuristic analysis so document status still reaches `ready`.
- PDF extraction no longer falls back to raw byte decoding; it now requires a real PDF extractor (`pypdf` or `pymupdf`) and fails fast otherwise.
- Scanned/low-text PDFs automatically trigger OCR fallback when extraction quality is too low (requires `pymupdf`, `pillow`, `pytesseract` + system tesseract binary).
- Entity CRM matching uses stricter thresholds (company ~= 0.82, contact ~= 0.90).
- Chat-side "Confirm & Link" only auto-links a company when there is exactly one high-confidence company match.
- RAG uses a single retrieval path (`hybrid_search` over `file_chunk`) with retrieval budgets:
  - `per_doc_cap` to prevent one long file from dominating context
  - `max_evidence_tokens` to cap retrieval context size
  - candidate caps for lexical/vector stages
  - reranking pass before final budget truncation
- Evidence contract for answers: cite source chunks (`[filename pX]`) or explicitly return "I couldn't find this information in the documents."
- Authorship-style questions ("who drafted/wrote/prepared") use extracted document entities first, then fall back to chunk retrieval.
- `ask_documents.document_ids` accepts UUIDs or filename/partial-filename references; filename-like inputs are resolved to matching document IDs server-side.

Retry endpoint:

- `POST /api/documents/{document_id}/retry`

## API Surface

- `GET /api/documents`
- `GET /api/documents/{document_id}`
- `POST /api/documents/upload`
- `POST /api/documents/link`
- `POST /api/documents/search`
- `POST /api/documents/ask`
- `POST /api/documents/{document_id}/retry`

`POST /api/documents/ask` supports optional retrieval controls:

- `limit_chunks`
- `per_doc_cap`
- `max_evidence_tokens`
- `rerank`

## UI Surface

- Route: `/documents`
- Left pane collections: All, Recent, Unlinked, Needs Review, Ready, Processing, Failed
- Center pane: metadata list with status and linkage
- Right inspector: summary, quick facts, link confirmation, ask-with-sources
- Chat composer:
  - drag-drop uploads and attachment-button uploads
  - upload and processing status events in-thread
  - analysis confirmation actions in-thread
  - create-missing-records and assumption-edit loop in chat
  - scoped ask flow for uploaded document with source citations
  - planner routing prefers `ask_documents`/`search_documents` for document/file questions (instead of CRM `hybrid_search(company)` plans)
  - follow-up prompts like "those documents" carry forward document IDs from prior `ask_documents` sources for scoped retrieval
  - follow-up authorship queries ("who drafted/wrote it") avoid over-narrowing to a single prior source unless user specifies a file/ID

## Configuration

- `DOCUMENT_STORAGE_BACKEND` (`local` or `s3`)
- `DOCUMENT_STORAGE_PATH`
- `DOCUMENT_MAX_SIZE_MB`
- `DOCUMENT_CHUNK_SIZE`
- `DOCUMENT_CHUNK_OVERLAP`
- `DOCUMENT_ANALYSIS_MODEL`
- `EMBEDDING_PROVIDER`
- `EMBEDDING_MODEL`
- `EMBEDDING_DIMENSIONS`
- `AWS_S3_BUCKET`, `AWS_S3_REGION`, credentials (when backend is `s3`)
