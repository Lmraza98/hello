from __future__ import annotations

import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


class DocumentStorageError(Exception):
    """Raised when storage operations fail."""


class DocumentStorage:
    backend_name: str = "unknown"

    async def save(self, file_bytes: bytes, filename: str) -> str:
        raise NotImplementedError

    async def load(self, storage_path: str) -> bytes:
        raise NotImplementedError

    async def delete(self, storage_path: str) -> bool:
        raise NotImplementedError

    async def get_url(self, storage_path: str, expires_in: int = 3600) -> str:
        raise NotImplementedError


@dataclass
class LocalDocumentStorage(DocumentStorage):
    base_path: Path
    backend_name: str = "local"

    def __post_init__(self) -> None:
        self.base_path.mkdir(parents=True, exist_ok=True)

    async def save(self, file_bytes: bytes, filename: str) -> str:
        safe_name = "".join(ch for ch in (filename or "file") if ch.isalnum() or ch in {"-", "_", "."}).strip(".")
        if not safe_name:
            safe_name = "file"
        now = datetime.now(timezone.utc)
        rel_dir = Path(str(now.year), f"{now.month:02d}")
        rel_path = rel_dir / f"{uuid.uuid4()}-{safe_name}"
        abs_path = self.base_path / rel_path
        abs_path.parent.mkdir(parents=True, exist_ok=True)
        abs_path.write_bytes(file_bytes)
        return str(rel_path).replace("\\", "/")

    async def load(self, storage_path: str) -> bytes:
        abs_path = self.base_path / storage_path
        if not abs_path.exists():
            raise DocumentStorageError(f"Document not found: {storage_path}")
        return abs_path.read_bytes()

    async def delete(self, storage_path: str) -> bool:
        abs_path = self.base_path / storage_path
        if not abs_path.exists():
            return False
        abs_path.unlink(missing_ok=True)
        return True

    async def get_url(self, storage_path: str, expires_in: int = 3600) -> str:
        _ = expires_in
        return str((self.base_path / storage_path).resolve())


@dataclass
class S3DocumentStorage(DocumentStorage):
    bucket: str
    region: str
    backend_name: str = "s3"

    def __post_init__(self) -> None:
        try:
            import boto3
        except Exception as exc:
            raise DocumentStorageError("boto3 is required for S3 document storage") from exc
        self.client = boto3.client("s3", region_name=self.region)

    async def save(self, file_bytes: bytes, filename: str) -> str:
        now = datetime.now(timezone.utc)
        key = f"documents/{now.year}/{now.month:02d}/{uuid.uuid4()}-{filename or 'file'}"
        self.client.put_object(Bucket=self.bucket, Key=key, Body=file_bytes)
        return key

    async def load(self, storage_path: str) -> bytes:
        response = self.client.get_object(Bucket=self.bucket, Key=storage_path)
        body = response.get("Body")
        if body is None:
            raise DocumentStorageError(f"Could not load S3 key: {storage_path}")
        return body.read()

    async def delete(self, storage_path: str) -> bool:
        self.client.delete_object(Bucket=self.bucket, Key=storage_path)
        return True

    async def get_url(self, storage_path: str, expires_in: int = 3600) -> str:
        return self.client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket, "Key": storage_path},
            ExpiresIn=expires_in,
        )


def get_document_storage() -> DocumentStorage:
    backend = os.getenv("DOCUMENT_STORAGE_BACKEND", "local").strip().lower()
    if backend == "s3":
        bucket = os.getenv("AWS_S3_BUCKET", "").strip()
        region = os.getenv("AWS_S3_REGION", "us-east-1").strip() or "us-east-1"
        if not bucket:
            raise DocumentStorageError("AWS_S3_BUCKET is required when DOCUMENT_STORAGE_BACKEND=s3")
        return S3DocumentStorage(bucket=bucket, region=region)
    base_path = Path(os.getenv("DOCUMENT_STORAGE_PATH", "./data/documents"))
    return LocalDocumentStorage(base_path=base_path)
