from __future__ import annotations

import csv
import io
import os
import zipfile
from dataclasses import dataclass
from xml.etree import ElementTree as ET


class UnsupportedFormatError(Exception):
    """Raised when extraction is not supported for a MIME type."""


@dataclass
class ExtractionResult:
    text: str
    page_count: int | None = None
    extraction_mode: str = "text"
    ocr_used: bool = False
    extraction_quality_score: float = 0.0


def _quality_score(text: str) -> float:
    if not text:
        return 0.0
    trimmed = text.strip()
    if not trimmed:
        return 0.0
    printable = sum(1 for ch in trimmed if ch.isprintable())
    printable_ratio = printable / max(len(trimmed), 1)
    tokens = [tok for tok in trimmed.split() if tok]
    token_count = len(tokens)
    avg_token_len = (sum(len(tok) for tok in tokens) / token_count) if token_count else 0.0
    token_density = min(1.0, token_count / max(len(trimmed) / 8.0, 1.0))
    score = (printable_ratio * 0.5) + (token_density * 0.3) + (min(avg_token_len / 6.0, 1.0) * 0.2)
    return round(max(0.0, min(score, 1.0)), 4)


def _needs_ocr(text: str) -> bool:
    score = _quality_score(text)
    if len((text or "").strip()) < 120:
        return True
    return score < 0.45


def _ocr_pdf_text(file_bytes: bytes) -> ExtractionResult:
    try:
        import fitz  # pymupdf
        from PIL import Image
        import pytesseract
    except Exception as exc:
        raise UnsupportedFormatError(
            "OCR fallback unavailable. Install pymupdf, pillow, and pytesseract for scanned PDFs."
        ) from exc

    doc = fitz.open(stream=file_bytes, filetype="pdf")
    pages: list[str] = []
    max_pages = min(len(doc), int(os.getenv("DOCUMENT_OCR_MAX_PAGES", "25")))
    for i in range(max_pages):
        page = doc[i]
        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
        image = Image.open(io.BytesIO(pix.tobytes("png")))
        pages.append(pytesseract.image_to_string(image) or "")
    text = "\n\n".join(pages).strip()
    return ExtractionResult(
        text=text,
        page_count=len(doc),
        extraction_mode="ocr",
        ocr_used=True,
        extraction_quality_score=_quality_score(text),
    )


def _extract_pdf_text(file_bytes: bytes) -> ExtractionResult:
    extracted: ExtractionResult | None = None
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(file_bytes))
        pages: list[str] = []
        for page in reader.pages:
            try:
                pages.append(page.extract_text() or "")
            except Exception:
                pages.append("")
        text = "\n\n".join(pages).strip()
        extracted = ExtractionResult(
            text=text,
            page_count=len(reader.pages),
            extraction_mode="text",
            ocr_used=False,
            extraction_quality_score=_quality_score(text),
        )
    except Exception:
        try:
            import fitz  # PyMuPDF

            doc = fitz.open(stream=file_bytes, filetype="pdf")
            pages = []
            for page in doc:
                pages.append(page.get_text() or "")
            text = "\n\n".join(pages).strip()
            extracted = ExtractionResult(
                text=text,
                page_count=len(doc),
                extraction_mode="text",
                ocr_used=False,
                extraction_quality_score=_quality_score(text),
            )
        except Exception as exc:
            raise UnsupportedFormatError(
                "Cannot extract PDF text. Install pypdf or pymupdf for PDF support."
            ) from exc
    if extracted is None:
        raise UnsupportedFormatError("PDF extraction failed")
    if _needs_ocr(extracted.text):
        try:
            return _ocr_pdf_text(file_bytes)
        except UnsupportedFormatError:
            return extracted
    return extracted


def _extract_docx_text(file_bytes: bytes) -> ExtractionResult:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
            xml_bytes = zf.read("word/document.xml")
        root = ET.fromstring(xml_bytes)
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        lines = [node.text for node in root.findall(".//w:t", ns) if node.text]
        text = "\n".join(lines).strip()
        return ExtractionResult(
            text=text,
            page_count=None,
            extraction_mode="text",
            ocr_used=False,
            extraction_quality_score=_quality_score(text),
        )
    except Exception as exc:
        raise UnsupportedFormatError("Unable to parse DOCX file") from exc


def _extract_csv_text(file_bytes: bytes) -> ExtractionResult:
    text = file_bytes.decode("utf-8", errors="ignore")
    reader = csv.reader(io.StringIO(text))
    rows: list[str] = []
    for idx, row in enumerate(reader):
        if idx > 500:
            break
        rows.append(" | ".join(col.strip() for col in row))
    text = "\n".join(rows)
    return ExtractionResult(
        text=text,
        page_count=None,
        extraction_mode="text",
        ocr_used=False,
        extraction_quality_score=_quality_score(text),
    )


async def _extract_image_text(file_bytes: bytes, mime_type: str) -> ExtractionResult:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise UnsupportedFormatError("Image extraction requires OPENAI_API_KEY")
    try:
        import base64
        from openai import AsyncOpenAI
    except Exception as exc:
        raise UnsupportedFormatError("Image extraction requires openai package") from exc

    model = os.getenv("DOCUMENT_ANALYSIS_MODEL", "gpt-4o-mini")
    data_url = f"data:{mime_type};base64,{base64.b64encode(file_bytes).decode('ascii')}"
    client = AsyncOpenAI(api_key=api_key)
    completion = await client.chat.completions.create(
        model=model,
        temperature=0,
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Extract visible text from this image. Return plain text only."},
                    {"type": "image_url", "image_url": {"url": data_url}},
                ],
            }
        ],
    )
    content = completion.choices[0].message.content or ""
    text = str(content).strip()
    return ExtractionResult(
        text=text,
        page_count=None,
        extraction_mode="ocr",
        ocr_used=True,
        extraction_quality_score=_quality_score(text),
    )


async def extract_text(file_bytes: bytes, mime_type: str, filename: str) -> ExtractionResult:
    mime = (mime_type or "").lower()
    lower_name = (filename or "").lower()

    if mime == "application/pdf" or lower_name.endswith(".pdf"):
        return _extract_pdf_text(file_bytes)

    if mime in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
    } or lower_name.endswith(".docx"):
        return _extract_docx_text(file_bytes)

    if mime in {
        "text/csv",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    } or lower_name.endswith(".csv"):
        return _extract_csv_text(file_bytes)

    if mime.startswith("image/"):
        return await _extract_image_text(file_bytes, mime)

    if mime in {"text/plain", "application/json"} or lower_name.endswith(".txt"):
        text = file_bytes.decode("utf-8", errors="ignore")
        return ExtractionResult(
            text=text,
            page_count=None,
            extraction_mode="text",
            ocr_used=False,
            extraction_quality_score=_quality_score(text),
        )

    raise UnsupportedFormatError(f"Cannot extract text from {mime_type}")
