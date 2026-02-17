#!/usr/bin/env python3
"""
Build an annotation template from a FunctionGemma training bundle exported by the UI.

Usage:
  python scripts/functiongemma_make_annotation_template.py \
    --bundle data/functiongemma_training_bundle.json \
    --out data/functiongemma_annotations.jsonl
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True, help="Path to exported training bundle JSON")
    parser.add_argument("--out", required=True, help="Path to output annotation JSONL")
    return parser.parse_args()


def choose_suggested_call(item: dict[str, Any]) -> tuple[str | None, dict[str, Any]]:
    native_calls = item.get("native_tool_calls") or []
    if native_calls:
        fn = native_calls[0].get("function") or {}
        args = fn.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        return fn.get("name"), args if isinstance(args, dict) else {}

    token_calls = item.get("token_tool_calls") or []
    if token_calls:
        first = token_calls[0]
        return first.get("name"), first.get("args") or {}

    return None, {}


def main() -> None:
    args = parse_args()
    bundle_path = Path(args.bundle)
    out_path = Path(args.out)

    bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
    failures = bundle.get("failures") or []

    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8", newline="\n") as f:
        for item in failures:
            suggested_tool, suggested_args = choose_suggested_call(item)
            row = {
                "id": item.get("id"),
                "timestamp": item.get("timestamp"),
                "user_message": item.get("user_message"),
                "route_reason": item.get("route_reason"),
                "selected_tools": item.get("selected_tools") or [],
                "failure_reason": item.get("failure_reason"),
                # Human labels to fill:
                "label_tool_name": suggested_tool or "",
                "label_arguments": suggested_args or {},
                "skip": False,
                "notes": "",
            }
            f.write(json.dumps(row, ensure_ascii=True) + "\n")

    print(f"Wrote annotation template: {out_path}")
    print("Next: edit each line and set label_tool_name + label_arguments (or skip=true).")


if __name__ == "__main__":
    main()

