from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import database as db


router = APIRouter(prefix="/api/notes", tags=["notes"])


EntityType = Literal["contact", "company", "campaign", "conversation", "email_thread", "email_message"]


class CreateNoteRequest(BaseModel):
    entity_type: EntityType = Field(..., description="Entity type the note is attached to")
    entity_id: str = Field(..., description="Entity id (string or numeric id serialized as string)")
    content: str = Field(..., description="Note content")


@router.post("")
def create_note(req: CreateNoteRequest) -> Any:
    content = (req.content or "").strip()
    if not content:
        raise HTTPException(status_code=400, detail="content is required")
    return db.create_entity_note(entity_type=req.entity_type, entity_id=str(req.entity_id), content=content)


@router.get("")
def list_notes(entity_type: EntityType, entity_id: str, limit: int = 50) -> Any:
    return {
        "notes": db.list_entity_notes(entity_type=entity_type, entity_id=str(entity_id), limit=max(1, min(int(limit), 200))),
    }

