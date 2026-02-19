from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass

import database as db
from services.documents.embeddings import generate_embeddings


@dataclass
class DocumentAnswer:
    answer: str
    sources: list[dict]
    confidence: float


_AUTHORSHIP_RE = re.compile(
    r"\b((who\b.*\b(drafted|wrote|authored|prepared|created))|author|drafter|prepared by|presented by)\b",
    re.IGNORECASE,
)
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.IGNORECASE)


def _is_authorship_question(question: str) -> bool:
    return bool(_AUTHORSHIP_RE.search(question or ""))


def _resolve_document_ids(document_ids: list[str] | None) -> tuple[list[str] | None, bool]:
    if not document_ids:
        return None, False

    candidates = [str(v).strip() for v in document_ids if str(v).strip()]
    if not candidates:
        return None, False

    resolved: set[str] = {v.lower() for v in candidates if _UUID_RE.match(v)}
    fuzzy_terms = [v for v in candidates if not _UUID_RE.match(v)]
    if fuzzy_terms:
        with db.get_db() as conn:
            cursor = conn.cursor()
            for term in fuzzy_terms[:20]:
                lowered = term.lower()
                cursor.execute(
                    """
                    SELECT id
                    FROM documents
                    WHERE LOWER(filename) = ?
                       OR LOWER(filename) LIKE ?
                    ORDER BY uploaded_at DESC
                    LIMIT 12
                    """,
                    (lowered, f"%{lowered}%"),
                )
                for row in cursor.fetchall():
                    resolved.add(str(row["id"]))

    return (sorted(resolved) if resolved else []), True


def _parse_entities(value: str | None) -> dict:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _looks_like_person_name(name: str) -> bool:
    text = str(name or "").strip()
    if not text:
        return False
    lowered = text.lower()
    blocked_terms = {
        "corp",
        "corporation",
        "inc",
        "llc",
        "ltd",
        "engineering",
        "department",
        "suite",
        "square",
        "portal",
        "workflow",
        "platform",
    }
    if any(term in lowered for term in blocked_terms):
        return False
    parts = re.split(r"\s+", text)
    if len(parts) < 2 or len(parts) > 4:
        return False
    alpha_parts = [p for p in parts if re.match(r"^[A-Za-z][A-Za-z.'-]*$", p)]
    return len(alpha_parts) >= 2


def _authorship_from_entities(
    question: str,
    document_ids: list[str] | None,
    company_id: int | None,
    contact_id: int | None,
) -> DocumentAnswer | None:
    if not _is_authorship_question(question):
        return None
    resolved_document_ids, had_explicit_doc_filter = _resolve_document_ids(document_ids)
    if had_explicit_doc_filter and resolved_document_ids == []:
        resolved_document_ids = None

    where = ["1=1"]
    params: list[object] = []
    if resolved_document_ids:
        placeholders = ",".join(["?"] * len(resolved_document_ids))
        where.append(f"d.id IN ({placeholders})")
        params.extend(resolved_document_ids)
    if company_id is not None:
        where.append("d.linked_company_id = ?")
        params.append(int(company_id))
    if contact_id is not None:
        where.append(
            "EXISTS (SELECT 1 FROM document_contacts dc WHERE dc.document_id = d.id AND dc.contact_id = ?)"
        )
        params.append(int(contact_id))

    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT d.id, d.filename, d.extracted_entities, d.summary
            FROM documents d
            WHERE {' AND '.join(where)}
            ORDER BY d.uploaded_at DESC
            LIMIT 40
            """,
            params,
        )
        docs = [dict(r) for r in cursor.fetchall()]

    people_hits: list[dict] = []
    for doc in docs:
        entities = _parse_entities(doc.get("extracted_entities"))
        contacts = entities.get("contacts") if isinstance(entities, dict) else []
        if not isinstance(contacts, list):
            contacts = []
        for c in contacts:
            if not isinstance(c, dict):
                continue
            name = str(c.get("name") or "").strip()
            if not name:
                continue
            if not _looks_like_person_name(name):
                continue
            role = str(c.get("role_in_document") or "").strip().lower()
            context = str(c.get("context") or "").strip()
            title = str(c.get("title") or "").strip()
            company = str(c.get("company") or "").strip()
            confidence = float(c.get("match_confidence") or 0.0)
            role_signal = (
                role in {"author", "presenter", "creator", "signatory", "estimate requester", "drafter"}
                or "presented by" in context.lower()
                or "prepared by" in context.lower()
                or "requested by" in context.lower()
            )
            people_hits.append(
                {
                    "document_id": doc["id"],
                    "filename": doc["filename"],
                    "name": name,
                    "title": title,
                    "company": company,
                    "role": role,
                    "context": context,
                    "confidence": confidence,
                    "role_signal": 1.0 if role_signal else 0.0,
                }
            )

    if not people_hits:
        return None

    people_hits.sort(key=lambda x: (x["role_signal"], x["confidence"]), reverse=True)
    top = people_hits[0]
    display = top["name"]
    if top.get("title"):
        display += f", {top['title']}"
    if top.get("company"):
        display += f" ({top['company']})"
    answer = (
        f"The most likely drafter/presenter mentioned is {display} "
        f"[{top['filename']}]."
    )
    if top.get("context"):
        answer += f" Context: \"{str(top['context'])[:180]}\"."

    return DocumentAnswer(
        answer=answer,
        sources=[
            {
                "document_id": top["document_id"],
                "filename": top["filename"],
                "page": None,
                "similarity": round(float(top["confidence"]), 4),
                "snippet": str(top.get("context") or "")[:220],
                "chunk_id": None,
            }
        ],
        confidence=max(0.35, min(0.95, float(top["confidence"]) or 0.6)),
    )


async def find_similar_chunks(
    question: str,
    document_ids: list[str] | None = None,
    company_id: int | None = None,
    contact_id: int | None = None,
    limit: int = 5,
    per_doc_cap: int | None = None,
    max_evidence_tokens: int | None = None,
    rerank: bool = True,
) -> list[dict]:
    resolved_document_ids, _ = _resolve_document_ids(document_ids)
    filters: dict = {
        "top_k_vector_candidates": max(60, int(limit) * 25),
        "top_k_lexical": max(80, int(limit) * 20),
        "per_doc_cap": int(os.getenv("DOCUMENT_RETRIEVAL_PER_DOC_CAP", "3")),
        "max_evidence_tokens": int(os.getenv("DOCUMENT_RETRIEVAL_MAX_EVIDENCE_TOKENS", "2800")),
        "min_vector_similarity": float(os.getenv("DOCUMENT_RETRIEVAL_MIN_SIMILARITY", "0.18")),
        "rerank": bool(rerank),
        "rerank_top_n": max(12, int(limit) * 4),
    }
    if per_doc_cap is not None:
        filters["per_doc_cap"] = max(1, min(int(per_doc_cap), 20))
    if max_evidence_tokens is not None:
        filters["max_evidence_tokens"] = max(200, min(int(max_evidence_tokens), 20000))
    if resolved_document_ids:
        filters["document_ids"] = resolved_document_ids
    if company_id is not None:
        filters["company_id"] = int(company_id)
    if contact_id is not None:
        filters["contact_id"] = int(contact_id)

    timings: dict = {}
    return db.hybrid_search(
        query=question,
        entity_types=["file_chunk"],
        filters=filters,
        k=max(1, min(int(limit), 20)),
        debug_timing=timings,
    )


async def _llm_answer(question: str, context: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return "I could not run generative answering because OPENAI_API_KEY is not configured."

    try:
        from openai import AsyncOpenAI

        model = os.getenv("DOCUMENT_ANALYSIS_MODEL", "gpt-4o-mini")
        client = AsyncOpenAI(api_key=api_key)
        completion = await client.chat.completions.create(
            model=model,
            temperature=0.1,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Answer only from provided evidence excerpts. "
                        "If the answer is not explicitly supported, reply exactly: "
                        "\"I couldn't find this information in the documents.\" "
                        "When supported, include citations like [filename pX]."
                    ),
                },
                {
                    "role": "user",
                    "content": f"EVIDENCE:\n{context}\n\nQUESTION:\n{question}",
                },
            ],
        )
        return (completion.choices[0].message.content or "").strip()
    except Exception:
        return "I could not generate a full answer from the model. Please review the source snippets."


async def ask_documents(
    question: str,
    document_ids: list[str] | None = None,
    company_id: int | None = None,
    contact_id: int | None = None,
    limit_chunks: int = 5,
    per_doc_cap: int | None = None,
    max_evidence_tokens: int | None = None,
    rerank: bool = True,
) -> DocumentAnswer:
    try:
        resolved_document_ids, had_explicit_doc_filter = _resolve_document_ids(document_ids)
        if had_explicit_doc_filter and resolved_document_ids == []:
            resolved_document_ids = None

        metadata_answer = _authorship_from_entities(
            question=question,
            document_ids=resolved_document_ids,
            company_id=company_id,
            contact_id=contact_id,
        )
        if metadata_answer is not None:
            return metadata_answer

        # Trigger embedding stack warmup when available; hybrid_search handles retrieval.
        try:
            await generate_embeddings([question])
        except Exception:
            pass

        matches = await find_similar_chunks(
            question=question,
            document_ids=resolved_document_ids,
            company_id=company_id,
            contact_id=contact_id,
            limit=limit_chunks,
            per_doc_cap=per_doc_cap,
            max_evidence_tokens=max_evidence_tokens,
            rerank=rerank,
        )
        if not matches:
            return DocumentAnswer(
                answer="I couldn't find this information in the documents.",
                sources=[],
                confidence=0.0,
            )

        chunk_ids: list[str] = []
        for item in matches:
            refs = item.get("source_refs") or []
            if refs and isinstance(refs, list) and isinstance(refs[0], dict):
                chunk_id = str(refs[0].get("chunk_id") or "").strip()
                if chunk_id:
                    chunk_ids.append(chunk_id)

        chunk_text_by_id: dict[str, str] = {}
        if chunk_ids:
            with db.get_db() as conn:
                cursor = conn.cursor()
                placeholders = ",".join(["?"] * len(chunk_ids))
                cursor.execute(
                    f"SELECT chunk_id, text FROM semantic_chunks WHERE chunk_id IN ({placeholders})",
                    chunk_ids,
                )
                for row in cursor.fetchall():
                    chunk_text_by_id[str(row["chunk_id"])] = str(row["text"] or "")

        doc_meta: dict[str, str] = {}
        with db.get_db() as conn:
            cursor = conn.cursor()
            unique_doc_ids = sorted({str(item.get("entity_id") or "") for item in matches if str(item.get("entity_id") or "")})
            placeholders = ",".join(["?"] * len(unique_doc_ids))
            if placeholders:
                cursor.execute(f"SELECT id, filename FROM documents WHERE id IN ({placeholders})", unique_doc_ids)
                for row in cursor.fetchall():
                    doc_meta[str(row["id"])] = str(row["filename"])

        context_parts: list[str] = []
        sources: list[dict] = []
        for item in matches:
            document_id = str(item.get("entity_id") or "")
            filename = doc_meta.get(document_id, document_id)
            refs = item.get("source_refs") or []
            ref0 = refs[0] if refs and isinstance(refs[0], dict) else {}
            chunk_id = str(ref0.get("chunk_id") or "")
            page_number = ref0.get("page_number")
            similarity = float(item.get("score_vec") or 0.0)
            content = chunk_text_by_id.get(chunk_id) or str(item.get("snippet") or "")
            citation = f"[{filename} p{page_number}]" if page_number is not None else f"[{filename}]"
            context_parts.append(f"{citation}\n{content}")
            sources.append(
                {
                    "document_id": document_id,
                    "filename": filename,
                    "page": page_number,
                    "similarity": round(similarity, 4),
                    "snippet": content[:220],
                    "chunk_id": chunk_id,
                }
            )

        context = "\n\n---\n\n".join(context_parts)
        answer = await _llm_answer(question=question, context=context)
        if not answer:
            answer = "I couldn't find this information in the documents."

        normalized = answer.lower()
        if normalized.startswith("i could not run generative answering"):
            return DocumentAnswer(
                answer=answer,
                sources=sources,
                confidence=max(float(item.get("score_vec") or 0.0) for item in matches),
            )
        has_not_found = "couldn't find this information in the documents" in normalized
        has_citation = "[" in answer and "]" in answer
        if not has_not_found and not has_citation:
            preview_lines: list[str] = []
            for src in sources[:3]:
                filename = str(src.get("filename") or src.get("document_id") or "document")
                page = src.get("page")
                cite = f"[{filename} p{page}]" if page is not None else f"[{filename}]"
                snippet = str(src.get("snippet") or "").strip().replace("\n", " ")
                if snippet:
                    preview_lines.append(f"- {cite} {snippet[:220]}")
            if preview_lines:
                answer = "I found relevant evidence but could not generate a fully grounded synthesis. Relevant excerpts:\n" + "\n".join(
                    preview_lines
                )
            else:
                answer = "I couldn't find this information in the documents."
                sources = []

        return DocumentAnswer(
            answer=answer,
            sources=sources,
            confidence=max(float(item.get("score_vec") or 0.0) for item in matches),
        )
    except Exception:
        return DocumentAnswer(
            answer="I couldn't find this information in the documents.",
            sources=[],
            confidence=0.0,
        )
