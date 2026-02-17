"""Export FastAPI OpenAPI spec and a compact endpoint catalog.

Usage:
    python scripts/export_api_docs.py
"""

from __future__ import annotations

import json
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from api.main import app


def _schema_label(node: dict | None) -> str:
    if not node:
        return "-"
    ref = node.get("$ref")
    if ref:
        return ref.split("/")[-1]
    node_type = node.get("type")
    if node_type:
        return str(node_type)
    if "anyOf" in node:
        return "anyOf"
    if "oneOf" in node:
        return "oneOf"
    return "inline"


def export_docs() -> tuple[Path, Path]:
    out_dir = ROOT / "docs" / "api"
    out_dir.mkdir(parents=True, exist_ok=True)

    openapi_path = out_dir / "openapi.json"
    endpoint_md_path = out_dir / "endpoints.md"

    spec = app.openapi()
    openapi_path.write_text(json.dumps(spec, indent=2), encoding="utf-8")

    lines: list[str] = []
    lines.append("---")
    lines.append('summary: "Generated catalog of FastAPI endpoints from the current OpenAPI schema."')
    lines.append("read_when:")
    lines.append("  - You need the canonical API surface")
    lines.append("  - You are checking request/response model coverage")
    lines.append('title: "API Endpoint Catalog"')
    lines.append("---")
    lines.append("")
    lines.append("# API Endpoint Catalog")
    lines.append("")
    lines.append("| Method | Path | Tag | Summary | Request | Response |")
    lines.append("|---|---|---|---|---|---|")

    for path in sorted(spec.get("paths", {})):
        path_item = spec["paths"][path]
        for method in ("get", "post", "put", "patch", "delete"):
            operation = path_item.get(method)
            if not operation:
                continue

            tag = (operation.get("tags") or ["-"])[0]
            summary = operation.get("summary") or "-"

            request_schema = "-"
            request_body = operation.get("requestBody", {})
            if request_body:
                content = request_body.get("content", {})
                if "application/json" in content:
                    request_schema = _schema_label(content["application/json"].get("schema"))
                elif "multipart/form-data" in content:
                    request_schema = _schema_label(content["multipart/form-data"].get("schema"))

            response_schema = "-"
            responses = operation.get("responses", {})
            success = responses.get("200") or responses.get("201")
            if success:
                content = success.get("content", {})
                if "application/json" in content:
                    response_schema = _schema_label(content["application/json"].get("schema"))

            lines.append(
                f"| {method.upper()} | `{path}` | {tag} | {summary} | {request_schema} | {response_schema} |"
            )

    endpoint_md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return openapi_path, endpoint_md_path


if __name__ == "__main__":
    openapi_file, endpoint_file = export_docs()
    print(f"OpenAPI spec exported: {openapi_file}")
    print(f"Endpoint catalog exported: {endpoint_file}")
