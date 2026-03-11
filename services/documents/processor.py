from __future__ import annotations

import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

import database as db
from services.documents.analysis import analysis_to_db_payload, analyze_document
from services.documents.chunking import chunk_text
from services.documents.embeddings import embedding_to_blob, generate_embeddings
from services.documents.extraction import extract_text
from services.documents.storage import get_document_storage


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_mime(filename: str, mime_type: str | None) -> str:
    if mime_type:
        return mime_type
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        return "application/pdf"
    if name.endswith(".docx"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if name.endswith(".csv"):
        return "text/csv"
    if name.endswith(".txt"):
        return "text/plain"
    return "application/octet-stream"


def create_document_record(
    *,
    filename: str,
    mime_type: str | None,
    file_size_bytes: int,
    storage_backend: str,
    storage_path: str,
    uploaded_by: str | None,
    conversation_id: str | None,
    source: str = "chat",
) -> str:
    document_id = str(uuid.uuid4())
    with db.get_db() as conn:
        candidate_name = filename.strip()
        existing_names = {
            str(row["filename"])
            for row in conn.execute(
                "SELECT filename FROM documents WHERE COALESCE(folder_path, '') = ''"
            ).fetchall()
        }
        if candidate_name in existing_names:
            path = Path(candidate_name)
            stem = path.stem or candidate_name
            suffix = path.suffix or ""
            index = 2
            while True:
                next_name = f"{stem} ({index}){suffix}"
                if next_name not in existing_names:
                    candidate_name = next_name
                    break
                index += 1
        conn.execute(
            """
            INSERT INTO documents (
                id, filename, mime_type, file_size_bytes, storage_backend, storage_path,
                status, uploaded_by, uploaded_at, source, conversation_id
            )
            VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP, ?, ?)
            """,
            (
                document_id,
                candidate_name,
                _normalize_mime(filename, mime_type),
                int(file_size_bytes),
                storage_backend,
                storage_path,
                uploaded_by,
                source,
                conversation_id,
            ),
        )
    return document_id


def update_document_status(document_id: str, status: str, message: str | None = None) -> None:
    with db.get_db() as conn:
        conn.execute(
            "UPDATE documents SET status = ?, status_message = ?, processed_at = CASE WHEN ? IN ('ready','failed') THEN CURRENT_TIMESTAMP ELSE processed_at END WHERE id = ?",
            (status, message, status, document_id),
        )


def _get_document(document_id: str) -> dict | None:
    with db.get_db() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
        return dict(row) if row else None


def _load_known_companies(limit: int = 100) -> list[dict]:
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT id, company_name, domain FROM targets ORDER BY updated_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def _load_known_contacts(limit: int = 200) -> list[dict]:
    with db.get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, title, company_name FROM linkedin_contacts ORDER BY scraped_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def _save_extraction(document_id: str, text: str, page_count: int | None) -> None:
    with db.get_db() as conn:
        conn.execute(
            """
            UPDATE documents
            SET extracted_text = ?, text_length = ?, page_count = ?
            WHERE id = ?
            """,
            (text, len(text or ""), page_count, document_id),
        )


def _save_chunks(document_id: str, chunks, embeddings: list[list[float]]) -> None:
    with db.get_db() as conn:
        conn.execute("DELETE FROM document_chunks WHERE document_id = ?", (document_id,))
        for chunk, embedding in zip(chunks, embeddings):
            conn.execute(
                """
                INSERT INTO document_chunks (
                    id, document_id, chunk_index, content, token_count, page_number,
                    start_char, end_char, embedding, embedding_model
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    document_id,
                    chunk.index,
                    chunk.content,
                    chunk.token_count,
                    chunk.page_number,
                    chunk.start_char,
                    chunk.end_char,
                    embedding_to_blob(embedding),
                    os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"),
                ),
            )


def _mirror_chunks_to_semantic(document_id: str, filename: str, chunks) -> None:
    with db.get_db() as conn:
        conn.execute("DELETE FROM semantic_chunks WHERE source_type = 'file_chunk' AND source_id = ?", (document_id,))
    for chunk in chunks:
        page_label = f"p{chunk.page_number}" if chunk.page_number is not None else "pNA"
        title = f"{filename} - {page_label}"
        metadata = {
            "title": title,
            "document_id": document_id,
            "chunk_index": chunk.index,
            "page_number": chunk.page_number,
            "start_char": chunk.start_char,
            "end_char": chunk.end_char,
            "token_count": chunk.token_count,
        }
        db.upsert_semantic_chunk(
            source_type="file_chunk",
            source_id=document_id,
            text=chunk.content,
            chunk_type=f"document_chunk_{chunk.index}",
            metadata=metadata,
            chunk_id=f"file_chunk:{document_id}:{chunk.index}",
        )


def _save_analysis(document_id: str, analysis_payload: dict) -> None:
    with db.get_db() as conn:
        conn.execute(
            """
            UPDATE documents
            SET document_type = ?,
                document_type_confidence = ?,
                summary = ?,
                key_points = ?,
                extracted_entities = ?
            WHERE id = ?
            """,
            (
                analysis_payload.get("document_type"),
                analysis_payload.get("document_type_confidence"),
                analysis_payload.get("summary"),
                analysis_payload.get("key_points"),
                analysis_payload.get("extracted_entities"),
                document_id,
            ),
        )


def _upsert_document_contacts(document_id: str, extracted_entities_json: str) -> None:
    try:
        entities = json.loads(extracted_entities_json or "{}")
    except Exception:
        entities = {}
    contacts = entities.get("contacts") if isinstance(entities, dict) else []
    if not isinstance(contacts, list):
        contacts = []

    with db.get_db() as conn:
        conn.execute("DELETE FROM document_contacts WHERE document_id = ?", (document_id,))
        for contact in contacts:
            crm_id = contact.get("matched_crm_id")
            if crm_id is None:
                continue
            try:
                crm_id_int = int(crm_id)
            except Exception:
                continue
            exists = conn.execute(
                "SELECT id FROM linkedin_contacts WHERE id = ?",
                (crm_id_int,),
            ).fetchone()
            if not exists:
                continue
            conn.execute(
                """
                INSERT OR REPLACE INTO document_contacts (
                    document_id, contact_id, mention_type, confidence, confirmed, context_snippet
                )
                VALUES (?, ?, ?, ?, 0, ?)
                """,
                (
                    document_id,
                    crm_id_int,
                    str(contact.get("role_in_document") or "mentioned"),
                    float(contact.get("match_confidence") or 0.0),
                    str(contact.get("context") or "")[:500],
                ),
            )


def refresh_document_semantic_metadata(document_id: str) -> None:
    with db.get_db() as conn:
        cursor = conn.cursor()
        doc = cursor.execute(
            "SELECT id, filename, linked_company_id, document_type, status FROM documents WHERE id = ?",
            (document_id,),
        ).fetchone()
        if not doc:
            return
        contact_rows = cursor.execute(
            "SELECT contact_id FROM document_contacts WHERE document_id = ?",
            (document_id,),
        ).fetchall()
        contact_ids = [int(r["contact_id"]) for r in contact_rows]
        chunk_rows = cursor.execute(
            """
            SELECT chunk_id, chunk_type, metadata
            FROM semantic_chunks
            WHERE source_type = 'file_chunk' AND source_id = ?
            """,
            (document_id,),
        ).fetchall()
        for row in chunk_rows:
            metadata = {}
            try:
                metadata = json.loads(row["metadata"] or "{}")
            except Exception:
                metadata = {}
            metadata["title"] = metadata.get("title") or f"{doc['filename']} - pNA"
            metadata["document_id"] = document_id
            metadata["filename"] = doc["filename"]
            metadata["linked_company_id"] = doc["linked_company_id"]
            metadata["document_type"] = doc["document_type"]
            metadata["document_status"] = doc["status"]
            metadata["linked_contact_ids"] = contact_ids
            cursor.execute(
                "UPDATE semantic_chunks SET metadata = ?, updated_at = CURRENT_TIMESTAMP WHERE chunk_id = ?",
                (json.dumps(metadata, ensure_ascii=False), row["chunk_id"]),
            )


async def process_document(document_id: str) -> None:
    doc = _get_document(document_id)
    if not doc:
        return

    try:
        storage = get_document_storage()
        update_document_status(document_id, "extracting")
        file_bytes = await storage.load(doc["storage_path"])

        extraction = await extract_text(file_bytes, doc.get("mime_type") or "", doc.get("filename") or "")
        _save_extraction(document_id, extraction.text, extraction.page_count)

        update_document_status(document_id, "chunking")
        chunks = chunk_text(extraction.text)

        update_document_status(document_id, "embedding")
        embeddings = await generate_embeddings([chunk.content for chunk in chunks]) if chunks else []
        _save_chunks(document_id, chunks, embeddings)
        _mirror_chunks_to_semantic(document_id, doc.get("filename") or document_id, chunks)

        update_document_status(document_id, "analyzing")
        analysis = await analyze_document(
            extracted_text=extraction.text,
            filename=doc.get("filename") or "",
            known_companies=_load_known_companies(),
            known_contacts=_load_known_contacts(),
        )
        payload = analysis_to_db_payload(analysis)
        _save_analysis(document_id, payload)
        _upsert_document_contacts(document_id, str(payload.get("extracted_entities") or "{}"))
        refresh_document_semantic_metadata(document_id)

        update_document_status(document_id, "ready")
    except Exception as exc:
        update_document_status(document_id, "failed", str(exc))


async def handle_chat_file_upload(file_bytes: bytes, filename: str, mime_type: str | None, conversation_id: str | None, user_id: str | None) -> dict:
    max_mb = int(os.getenv("DOCUMENT_MAX_SIZE_MB", "50"))
    if len(file_bytes) > max_mb * 1024 * 1024:
        raise ValueError(f"File exceeds DOCUMENT_MAX_SIZE_MB={max_mb}")

    storage = get_document_storage()
    storage_path = await storage.save(file_bytes, filename)

    document_id = create_document_record(
        filename=filename,
        mime_type=mime_type,
        file_size_bytes=len(file_bytes),
        storage_backend=storage.backend_name,
        storage_path=storage_path,
        uploaded_by=user_id,
        conversation_id=conversation_id,
        source="chat",
    )

    asyncio.create_task(process_document(document_id))

    return {
        "document_id": document_id,
        "filename": filename,
        "status": "pending",
        "message": "Document uploaded. Processing started.",
        "created_at": _utc_now_iso(),
    }
