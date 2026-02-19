from __future__ import annotations

import os
import re
from dataclasses import dataclass


_WORD_RE = re.compile(r"\S+")


@dataclass
class Chunk:
    index: int
    content: str
    token_count: int
    start_char: int
    end_char: int
    page_number: int | None = None


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    return max(1, len(text.split()))


def chunk_text(text: str, chunk_size: int | None = None, chunk_overlap: int | None = None) -> list[Chunk]:
    source = text or ""
    if not source.strip():
        return []

    size = int(chunk_size or os.getenv("DOCUMENT_CHUNK_SIZE", "800"))
    overlap = int(chunk_overlap or os.getenv("DOCUMENT_CHUNK_OVERLAP", "100"))
    size = max(100, size)
    overlap = max(0, min(overlap, size // 2))

    words = list(_WORD_RE.finditer(source))
    if not words:
        return []

    chunks: list[Chunk] = []
    start_idx = 0
    chunk_index = 0

    while start_idx < len(words):
        end_idx = min(len(words), start_idx + size)
        start_char = words[start_idx].start()
        end_char = words[end_idx - 1].end()
        content = source[start_char:end_char].strip()
        chunks.append(
            Chunk(
                index=chunk_index,
                content=content,
                token_count=_estimate_tokens(content),
                start_char=start_char,
                end_char=end_char,
                page_number=None,
            )
        )
        chunk_index += 1
        if end_idx >= len(words):
            break
        start_idx = max(start_idx + 1, end_idx - overlap)

    return chunks
