"""Ollama embedding generation for semantic search.

Uses the local Ollama instance to compute dense vector embeddings.
The default model (``nomic-embed-text``) produces 768-dimensional
float32 vectors and runs entirely on-device.
"""

import logging
import os
import struct
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

OLLAMA_BASE = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "nomic-embed-text")
EMBEDDING_DIMENSIONS = 768  # nomic-embed-text default


def embed_text(text: str, model: str | None = None) -> Optional[list[float]]:
    """Generate a dense embedding for ``text`` via the local Ollama instance.

    Returns a list of floats, or None if embedding fails.
    """
    if not text or not text.strip():
        return None

    model = model or EMBEDDING_MODEL

    try:
        resp = httpx.post(
            f"{OLLAMA_BASE}/api/embed",
            json={"model": model, "input": text.strip()},
            timeout=15.0,
        )
        if resp.status_code != 200:
            logger.warning("Embedding API error %s: %s", resp.status_code, resp.text[:200])
            return None

        data = resp.json()
        # Ollama /api/embed returns {"embeddings": [[...], ...]}
        embeddings = data.get("embeddings")
        if embeddings and len(embeddings) > 0:
            return embeddings[0]

        # Fallback: older Ollama versions use "embedding" (singular)
        embedding = data.get("embedding")
        if embedding and isinstance(embedding, list):
            return embedding

        return None
    except Exception as exc:
        logger.debug("Embedding failed for text[:%d]: %s", min(len(text), 60), exc)
        return None


def embedding_to_blob(embedding: list[float]) -> bytes:
    """Pack a float list into a compact binary blob (little-endian float32)."""
    return struct.pack(f"<{len(embedding)}f", *embedding)


def blob_to_embedding(blob: bytes) -> list[float]:
    """Unpack a binary blob back into a float list."""
    count = len(blob) // 4
    return list(struct.unpack(f"<{count}f", blob))


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(x * x for x in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
