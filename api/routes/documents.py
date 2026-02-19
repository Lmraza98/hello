from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

import database as db
from api.routes._helpers import COMMON_ERROR_RESPONSES
from services.documents.processor import handle_chat_file_upload, process_document, refresh_document_semantic_metadata
from services.documents.rag import ask_documents


router = APIRouter(prefix="/api/documents", tags=["documents"])


class LinkDocumentRequest(BaseModel):
    document_id: str
    company_id: int | None = None
    contact_ids: list[int] = Field(default_factory=list)


class AskDocumentsRequest(BaseModel):
    question: str
    document_ids: list[str] | None = None
    company_id: int | None = None
    contact_id: int | None = None
    limit_chunks: int = 5
    per_doc_cap: int | None = None
    max_evidence_tokens: int | None = None
    rerank: bool = True


class SearchDocumentsRequest(BaseModel):
    query: str
    document_type: str | None = None
    company_id: int | None = None
    limit: int = 10


@router.post("/upload", responses=COMMON_ERROR_RESPONSES)
async def upload_document(
    file: UploadFile = File(...),
    conversation_id: str | None = Form(default=None),
    user_id: str | None = Form(default=None),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail={"code": "missing_filename", "message": "Uploaded file is missing a filename"})
    data = await file.read()
    try:
        result = await handle_chat_file_upload(
            file_bytes=data,
            filename=file.filename,
            mime_type=file.content_type,
            conversation_id=conversation_id,
            user_id=user_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail={"code": "invalid_upload", "message": str(exc)}) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail={"code": "upload_failed", "message": str(exc)}) from exc
    return result


@router.get("", responses=COMMON_ERROR_RESPONSES)
def list_documents(
    q: str | None = None,
    status: str | None = None,
    company_id: int | None = None,
    document_type: str | None = None,
    collection: str | None = None,
    limit: int = 100,
    offset: int = 0,
):
    filters: list[str] = []
    params: list[Any] = []

    if q:
        filters.append("(LOWER(d.filename) LIKE ? OR LOWER(COALESCE(d.summary,'')) LIKE ? OR LOWER(COALESCE(d.extracted_text,'')) LIKE ?)")
        like = f"%{q.lower()}%"
        params.extend([like, like, like])

    if status:
        filters.append("d.status = ?")
        params.append(status)

    if company_id is not None:
        filters.append("d.linked_company_id = ?")
        params.append(int(company_id))

    if document_type:
        filters.append("d.document_type = ?")
        params.append(document_type)

    if collection == "unlinked":
        filters.append("d.linked_company_id IS NULL")
    if collection == "needs_review":
        filters.append("(d.status = 'failed' OR COALESCE(d.link_confirmed, 0) = 0)")

    where = f"WHERE {' AND '.join(filters)}" if filters else ""

    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT d.*,
                   t.company_name AS linked_company_name,
                   (SELECT COUNT(1) FROM document_contacts dc WHERE dc.document_id = d.id) AS linked_contact_count,
                   (SELECT COUNT(1) FROM document_chunks ck WHERE ck.document_id = d.id) AS chunk_count
            FROM documents d
            LEFT JOIN targets t ON t.id = d.linked_company_id
            {where}
            ORDER BY d.uploaded_at DESC, d.id DESC
            LIMIT ? OFFSET ?
            """,
            [*params, max(1, min(int(limit), 500)), max(0, int(offset))],
        )
        rows = [dict(r) for r in cursor.fetchall()]

        cursor.execute(f"SELECT COUNT(1) AS c FROM documents d {where}", params)
        total = int(cursor.fetchone()["c"])

    for row in rows:
        for key in ("key_points", "extracted_entities"):
            try:
                if isinstance(row.get(key), str):
                    row[key] = json.loads(row[key])
            except Exception:
                row[key] = None

    return {"count": total, "documents": rows}


@router.get("/{document_id}", responses=COMMON_ERROR_RESPONSES)
def get_document(document_id: str):
    with db.get_db() as conn:
        cursor = conn.cursor()
        row = cursor.execute(
            """
            SELECT d.*, t.company_name AS linked_company_name
            FROM documents d
            LEFT JOIN targets t ON t.id = d.linked_company_id
            WHERE d.id = ?
            """,
            (document_id,),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Document not found"})

        contacts = cursor.execute(
            """
            SELECT dc.contact_id, dc.mention_type, dc.confidence, dc.confirmed, dc.context_snippet, lc.name
            FROM document_contacts dc
            JOIN linkedin_contacts lc ON lc.id = dc.contact_id
            WHERE dc.document_id = ?
            ORDER BY dc.confidence DESC
            """,
            (document_id,),
        ).fetchall()

        chunk_count = cursor.execute(
            "SELECT COUNT(1) AS c FROM document_chunks WHERE document_id = ?",
            (document_id,),
        ).fetchone()["c"]

    item = dict(row)
    for key in ("key_points", "extracted_entities"):
        try:
            if isinstance(item.get(key), str):
                item[key] = json.loads(item[key])
        except Exception:
            item[key] = None

    return {
        "document": item,
        "contacts": [dict(r) for r in contacts],
        "chunk_count": int(chunk_count),
    }


@router.post("/link", responses=COMMON_ERROR_RESPONSES)
def link_document_to_entities(request: LinkDocumentRequest):
    with db.get_db() as conn:
        cursor = conn.cursor()
        exists = cursor.execute("SELECT id FROM documents WHERE id = ?", (request.document_id,)).fetchone()
        if not exists:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Document not found"})

        cursor.execute(
            """
            UPDATE documents
            SET linked_company_id = ?,
                link_confirmed = 1,
                link_confirmed_at = CURRENT_TIMESTAMP,
                link_confirmed_by = COALESCE(link_confirmed_by, 'user')
            WHERE id = ?
            """,
            (request.company_id, request.document_id),
        )

        if request.contact_ids:
            for contact_id in request.contact_ids:
                cursor.execute(
                    """
                    INSERT INTO document_contacts (document_id, contact_id, mention_type, confidence, confirmed, context_snippet)
                    VALUES (?, ?, 'mentioned', 1.0, 1, '')
                    ON CONFLICT(document_id, contact_id)
                    DO UPDATE SET confirmed = 1
                    """,
                    (request.document_id, int(contact_id)),
                )
    refresh_document_semantic_metadata(request.document_id)

    return {"success": True, "document_id": request.document_id}


@router.post("/{document_id}/retry", responses=COMMON_ERROR_RESPONSES)
async def retry_document_processing(document_id: str):
    with db.get_db() as conn:
        row = conn.execute("SELECT id FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Document not found"})

    import asyncio

    asyncio.create_task(process_document(document_id))
    return {"success": True, "document_id": document_id, "status": "pending"}


@router.post("/ask", responses=COMMON_ERROR_RESPONSES)
async def ask_documents_route(request: AskDocumentsRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail={"code": "missing_question", "message": "question is required"})

    result = await ask_documents(
        question=request.question,
        document_ids=request.document_ids,
        company_id=request.company_id,
        contact_id=request.contact_id,
        limit_chunks=max(1, min(int(request.limit_chunks or 5), 20)),
        per_doc_cap=request.per_doc_cap,
        max_evidence_tokens=request.max_evidence_tokens,
        rerank=bool(request.rerank),
    )
    return {
        "answer": result.answer,
        "sources": result.sources,
        "confidence": round(float(result.confidence), 4),
    }


@router.post("/search", responses=COMMON_ERROR_RESPONSES)
def search_documents(request: SearchDocumentsRequest):
    q = request.query.strip().lower()
    if not q:
        raise HTTPException(status_code=400, detail={"code": "missing_query", "message": "query is required"})

    filters: list[str] = [
        "(LOWER(d.filename) LIKE ? OR LOWER(COALESCE(d.summary,'')) LIKE ? OR LOWER(COALESCE(d.extracted_text,'')) LIKE ?)"
    ]
    like = f"%{q}%"
    params: list[Any] = [like, like, like]

    if request.document_type:
        filters.append("d.document_type = ?")
        params.append(request.document_type)
    if request.company_id is not None:
        filters.append("d.linked_company_id = ?")
        params.append(int(request.company_id))

    where = f"WHERE {' AND '.join(filters)}"
    with db.get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT d.id, d.filename, d.status, d.document_type, d.summary, d.uploaded_at, t.company_name AS linked_company_name
            FROM documents d
            LEFT JOIN targets t ON t.id = d.linked_company_id
            {where}
            ORDER BY d.uploaded_at DESC, d.id DESC
            LIMIT ?
            """,
            [*params, max(1, min(int(request.limit or 10), 100))],
        )
        rows = [dict(r) for r in cursor.fetchall()]

    return {"results": rows, "count": len(rows)}
