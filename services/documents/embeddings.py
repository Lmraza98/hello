from __future__ import annotations

import hashlib
import os
import struct
from typing import Iterable

import math


def _dimensions() -> int:
    return max(128, int(os.getenv("EMBEDDING_DIMENSIONS", "1536")))


def _deterministic_embedding(text: str, dims: int) -> list[float]:
    vec = [0.0] * dims
    tokens = text.lower().split()
    if not tokens:
        return vec
    for token in tokens:
        digest = hashlib.sha256(token.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "little") % dims
        sign = 1.0 if digest[4] % 2 == 0 else -1.0
        vec[idx] += sign
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


async def generate_embeddings(texts: list[str]) -> list[list[float]]:
    provider = os.getenv("EMBEDDING_PROVIDER", "openai").strip().lower()
    model = os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")
    dims = _dimensions()

    if provider == "openai":
        api_key = os.getenv("OPENAI_API_KEY", "").strip()
        if api_key:
            try:
                from openai import AsyncOpenAI

                client = AsyncOpenAI(api_key=api_key)
                response = await client.embeddings.create(model=model, input=texts)
                vectors = [item.embedding for item in response.data]
                if vectors:
                    return vectors
            except Exception:
                pass

    if provider == "local":
        try:
            from sentence_transformers import SentenceTransformer

            local_model = SentenceTransformer(model)
            vectors = local_model.encode(texts).tolist()
            if vectors:
                return vectors
        except Exception:
            pass

    return [_deterministic_embedding(text, dims) for text in texts]


def embedding_to_blob(embedding: Iterable[float]) -> bytes:
    values = list(float(x) for x in embedding)
    return struct.pack(f"<{len(values)}f", *values)


def blob_to_embedding(blob: bytes) -> list[float]:
    if not blob:
        return []
    count = len(blob) // 4
    if count <= 0:
        return []
    return list(struct.unpack(f"<{count}f", blob[: count * 4]))


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    n = min(len(a), len(b))
    if n == 0:
        return 0.0
    dot = sum(a[i] * b[i] for i in range(n))
    norm_a = math.sqrt(sum(a[i] * a[i] for i in range(n)))
    norm_b = math.sqrt(sum(b[i] * b[i] for i in range(n)))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)
