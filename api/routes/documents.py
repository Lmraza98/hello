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


class CreateFolderRequest(BaseModel):
    name: str
    parent_path: str = ""


class MoveFolderRequest(BaseModel):
    from_path: str
    to_parent_path: str = ""


class MoveDocumentRequest(BaseModel):
    to_folder_path: str = ""


class RenameFolderRequest(BaseModel):
    name: str


class RenameDocumentRequest(BaseModel):
    name: str


def _normalize_folder_path(path: str | None) -> str:
    raw = (path or "").strip().replace("\\", "/")
    if not raw:
        return ""
    parts = [seg.strip() for seg in raw.split("/") if seg.strip() and seg.strip() not in {".", ".."}]
    return "/".join(parts)


def _folder_name(path: str) -> str:
    normalized = _normalize_folder_path(path)
    if not normalized:
        return ""
    return normalized.split("/")[-1]


def _is_descendant(path: str, candidate_ancestor: str) -> bool:
    if not candidate_ancestor:
        return True
    return path == candidate_ancestor or path.startswith(f"{candidate_ancestor}/")


def _ensure_folder_chain(cursor, path: str):
    normalized = _normalize_folder_path(path)
    if not normalized:
        return
    current = ""
    for part in normalized.split("/"):
        parent = current
        current = f"{current}/{part}" if current else part
        exists = cursor.execute("SELECT 1 FROM document_folders WHERE path = ?", (current,)).fetchone()
        if exists:
            continue
        cursor.execute(
            """
            INSERT INTO document_folders (path, parent_path, name)
            VALUES (?, ?, ?)
            """,
            (current, parent, part),
        )


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


@router.get("/folders", responses=COMMON_ERROR_RESPONSES)
def list_document_folders():
    with db.get_db() as conn:
        cursor = conn.cursor()
        rows = cursor.execute(
            """
            SELECT path, parent_path, name, created_at, updated_at
            FROM document_folders
            ORDER BY path ASC
            """
        ).fetchall()
    return {"count": len(rows), "folders": [dict(r) for r in rows]}


@router.post("/folders", responses=COMMON_ERROR_RESPONSES)
def create_document_folder(request: CreateFolderRequest):
    name = request.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail={"code": "invalid_name", "message": "Folder name is required"})
    if "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail={"code": "invalid_name", "message": "Folder name cannot contain slashes"})

    parent = _normalize_folder_path(request.parent_path)
    path = _normalize_folder_path(f"{parent}/{name}" if parent else name)

    with db.get_db() as conn:
        cursor = conn.cursor()
        if parent:
            parent_exists = cursor.execute("SELECT 1 FROM document_folders WHERE path = ?", (parent,)).fetchone()
            if not parent_exists:
                raise HTTPException(status_code=404, detail={"code": "parent_not_found", "message": "Parent folder not found"})
        exists = cursor.execute("SELECT 1 FROM document_folders WHERE path = ?", (path,)).fetchone()
        if exists:
            raise HTTPException(status_code=409, detail={"code": "already_exists", "message": "Folder already exists"})

        cursor.execute(
            """
            INSERT INTO document_folders (path, parent_path, name)
            VALUES (?, ?, ?)
            """,
            (path, parent, name),
        )

    return {"success": True, "path": path, "parent_path": parent, "name": name}


@router.post("/folders/move", responses=COMMON_ERROR_RESPONSES)
def move_document_folder(request: MoveFolderRequest):
    from_path = _normalize_folder_path(request.from_path)
    to_parent = _normalize_folder_path(request.to_parent_path)
    if not from_path:
        raise HTTPException(status_code=400, detail={"code": "invalid_source", "message": "Source folder is required"})

    base_name = _folder_name(from_path)
    target_path = _normalize_folder_path(f"{to_parent}/{base_name}" if to_parent else base_name)
    if target_path == from_path:
        return {"success": True, "path": from_path}
    if _is_descendant(to_parent, from_path):
        raise HTTPException(status_code=400, detail={"code": "invalid_move", "message": "Cannot move folder into itself"})

    with db.get_db() as conn:
        cursor = conn.cursor()

        explicit_src = cursor.execute("SELECT 1 FROM document_folders WHERE path = ?", (from_path,)).fetchone()
        docs_src = cursor.execute(
            "SELECT 1 FROM documents WHERE folder_path = ? OR folder_path LIKE ? LIMIT 1",
            (from_path, f"{from_path}/%"),
        ).fetchone()
        if not explicit_src and not docs_src:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Folder not found"})

        if to_parent:
            _ensure_folder_chain(cursor, to_parent)

        clash = cursor.execute("SELECT 1 FROM document_folders WHERE path = ?", (target_path,)).fetchone()
        if clash:
            raise HTTPException(status_code=409, detail={"code": "already_exists", "message": "A folder already exists at destination"})

        rows = cursor.execute(
            "SELECT path FROM document_folders WHERE path = ? OR path LIKE ? ORDER BY LENGTH(path) ASC",
            (from_path, f"{from_path}/%"),
        ).fetchall()
        for row in rows:
            old_path = row["path"]
            suffix = old_path[len(from_path):]
            new_path = f"{target_path}{suffix}"
            new_parent = _normalize_folder_path(new_path.rsplit("/", 1)[0] if "/" in new_path else "")
            new_name = _folder_name(new_path)
            cursor.execute(
                """
                UPDATE document_folders
                SET path = ?, parent_path = ?, name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE path = ?
                """,
                (new_path, new_parent, new_name, old_path),
            )

        doc_rows = cursor.execute(
            "SELECT id, folder_path FROM documents WHERE folder_path = ? OR folder_path LIKE ?",
            (from_path, f"{from_path}/%"),
        ).fetchall()
        for row in doc_rows:
            old = _normalize_folder_path(row["folder_path"])
            suffix = old[len(from_path):]
            new_doc_path = _normalize_folder_path(f"{target_path}{suffix}")
            cursor.execute("UPDATE documents SET folder_path = ? WHERE id = ?", (new_doc_path, row["id"]))

    return {"success": True, "path": target_path}


@router.post("/{document_id}/move", responses=COMMON_ERROR_RESPONSES)
def move_document(document_id: str, request: MoveDocumentRequest):
    to_folder = _normalize_folder_path(request.to_folder_path)

    with db.get_db() as conn:
        cursor = conn.cursor()
        doc = cursor.execute("SELECT id FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Document not found"})
        if to_folder:
            _ensure_folder_chain(cursor, to_folder)
        cursor.execute("UPDATE documents SET folder_path = ? WHERE id = ?", (to_folder, document_id))

    return {"success": True, "document_id": document_id, "folder_path": to_folder}


@router.delete("/folders/{folder_path:path}", responses=COMMON_ERROR_RESPONSES)
def delete_document_folder(folder_path: str):
    path = _normalize_folder_path(folder_path)
    if not path:
        raise HTTPException(status_code=400, detail={"code": "invalid_path", "message": "Folder path is required"})

    with db.get_db() as conn:
        cursor = conn.cursor()
        folder = cursor.execute("SELECT 1 FROM document_folders WHERE path = ?", (path,)).fetchone()
        if not folder:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Folder not found"})

        child_folder = cursor.execute("SELECT 1 FROM document_folders WHERE parent_path = ? LIMIT 1", (path,)).fetchone()
        if child_folder:
            raise HTTPException(status_code=409, detail={"code": "not_empty", "message": "Folder has subfolders"})

        doc_ref = cursor.execute("SELECT 1 FROM documents WHERE folder_path = ? LIMIT 1", (path,)).fetchone()
        if doc_ref:
            raise HTTPException(status_code=409, detail={"code": "not_empty", "message": "Folder has documents"})

        cursor.execute("DELETE FROM document_folders WHERE path = ?", (path,))

    return {"success": True, "path": path}


@router.patch("/folders/{folder_path:path}/rename", responses=COMMON_ERROR_RESPONSES)
def rename_document_folder(folder_path: str, request: RenameFolderRequest):
    from_path = _normalize_folder_path(folder_path)
    next_name = request.name.strip()
    if not from_path:
        raise HTTPException(status_code=400, detail={"code": "invalid_path", "message": "Folder path is required"})
    if not next_name:
        raise HTTPException(status_code=400, detail={"code": "invalid_name", "message": "Folder name is required"})
    if "/" in next_name or "\\" in next_name:
        raise HTTPException(status_code=400, detail={"code": "invalid_name", "message": "Folder name cannot contain slashes"})

    parent = _normalize_folder_path(from_path.rsplit("/", 1)[0] if "/" in from_path else "")
    target_path = _normalize_folder_path(f"{parent}/{next_name}" if parent else next_name)
    if target_path == from_path:
        return {"success": True, "path": from_path, "name": _folder_name(from_path)}

    with db.get_db() as conn:
        cursor = conn.cursor()
        src = cursor.execute("SELECT 1 FROM document_folders WHERE path = ?", (from_path,)).fetchone()
        if not src:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Folder not found"})
        clash = cursor.execute("SELECT 1 FROM document_folders WHERE path = ?", (target_path,)).fetchone()
        if clash:
            raise HTTPException(status_code=409, detail={"code": "already_exists", "message": "A folder already exists at destination"})

        rows = cursor.execute(
            "SELECT path FROM document_folders WHERE path = ? OR path LIKE ? ORDER BY LENGTH(path) ASC",
            (from_path, f"{from_path}/%"),
        ).fetchall()
        for row in rows:
            old_path = row["path"]
            suffix = old_path[len(from_path):]
            new_path = f"{target_path}{suffix}"
            new_parent = _normalize_folder_path(new_path.rsplit("/", 1)[0] if "/" in new_path else "")
            new_name = _folder_name(new_path)
            cursor.execute(
                """
                UPDATE document_folders
                SET path = ?, parent_path = ?, name = ?, updated_at = CURRENT_TIMESTAMP
                WHERE path = ?
                """,
                (new_path, new_parent, new_name, old_path),
            )

        doc_rows = cursor.execute(
            "SELECT id, folder_path FROM documents WHERE folder_path = ? OR folder_path LIKE ?",
            (from_path, f"{from_path}/%"),
        ).fetchall()
        for row in doc_rows:
            old = _normalize_folder_path(row["folder_path"])
            suffix = old[len(from_path):]
            new_doc_path = _normalize_folder_path(f"{target_path}{suffix}")
            cursor.execute("UPDATE documents SET folder_path = ? WHERE id = ?", (new_doc_path, row["id"]))

    return {"success": True, "path": target_path, "name": next_name}


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


@router.patch("/{document_id}/rename", responses=COMMON_ERROR_RESPONSES)
def rename_document(document_id: str, request: RenameDocumentRequest):
    next_name = request.name.strip()
    if not next_name:
        raise HTTPException(status_code=400, detail={"code": "invalid_name", "message": "Document name is required"})
    if "/" in next_name or "\\" in next_name:
        raise HTTPException(status_code=400, detail={"code": "invalid_name", "message": "Document name cannot contain slashes"})

    with db.get_db() as conn:
        cursor = conn.cursor()
        row = cursor.execute("SELECT filename, storage_path FROM documents WHERE id = ?", (document_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Document not found"})

        old_filename = str(row["filename"] or "").strip()
        storage_path = str(row["storage_path"] or "")
        new_storage_path = storage_path
        if old_filename and storage_path:
            normalized_storage = storage_path.replace("\\", "/")
            if normalized_storage.lower().endswith(f"/{old_filename.lower()}"):
                new_storage_path = f"{normalized_storage[:-(len(old_filename))]}{next_name}"

        cursor.execute(
            """
            UPDATE documents
            SET filename = ?,
                storage_path = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (next_name, new_storage_path, document_id),
        )

    return {"success": True, "document_id": document_id, "filename": next_name}


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
