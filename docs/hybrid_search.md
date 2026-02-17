---
summary: "Unified retrieval API across CRM entities, conversations, and semantic chunks."
read_when:
  - You are implementing or debugging hybrid retrieval
  - You need ranking/scoring details for search results
title: "Hybrid Search"
---

# Hybrid Search

`hybrid_search` provides one retrieval API/tool across CRM entities, emails, conversations, notes, and semantic chunks.

## API

- Endpoint: `POST /api/search/hybrid`
- Tool: `hybrid_search(query, entity_types, filters, k)`

Request fields:
- `query` (required): natural-language search query.
- `entity_types`: any of `contact`, `company`, `campaign`, `note`, `conversation`, `email_message`, `email_thread`, `file_chunk`.
- `filters`: optional map (`time_range`, `campaign_id`, `company_id`, `contact_id`, `domain`, `folder`, `scope`).
- `k`: max number of results.

Response:
- `results`: list with
  - `entity_type`, `entity_id`
  - `score_total`, `score_exact`, `score_lex`, `score_vec`
  - `title`, `snippet`
  - `source_refs` (row/chunk evidence)
  - `timestamp`

## Scoring

The ranker merges three stages:

1. Exact stage
- Deterministic match on IDs, exact normalized names, exact email, normalized phone.
- Strong boost via `score_exact`.

2. Lexical stage
- Fast local lookup via `entity_search_index`.
- Token overlap against indexed text fields contributes `score_lex`.

3. Semantic/vector stage
- Reads `semantic_chunks` and computes token-overlap similarity as a vector fallback.
- Contributes `score_vec`.
- `source_refs` include `chunk_id` when chunk-backed evidence exists.

`score_total = score_exact * 100 + score_lex * 40 + score_vec * 25`

## Storage

- `semantic_chunks`
  - `chunk_id`, `source_type`, `source_id`, `chunk_type`, `text`, `created_at`, `updated_at`, `metadata`
- `entity_search_index`
  - `entity_type`, `entity_id`, `name`, `emails`, `phones`, `domain`, `keywords`, `updated_at`

## Grounding

`source_refs` are included for each result so the assistant can ground claims in local evidence and cite references.
