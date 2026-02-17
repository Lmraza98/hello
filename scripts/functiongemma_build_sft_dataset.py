#!/usr/bin/env python3
"""
Build Hugging Face SFT JSONL from labeled FunctionGemma annotations.

Usage:
  python scripts/functiongemma_build_sft_dataset.py \
    --bundle data/functiongemma_training_bundle.json \
    --annotations data/functiongemma_annotations_labeled.jsonl \
    --out-train data/functiongemma_train.jsonl \
    --out-test data/functiongemma_test.jsonl \
    --test-size 0.2
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path
from typing import Any


DEFAULT_SYSTEM_MSG = "You are a model that can do function calling with the following functions"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", required=True, help="Path to exported training bundle JSON")
    parser.add_argument("--annotations", required=True, help="Path to labeled annotation JSONL")
    parser.add_argument("--out-train", required=True, help="Output train JSONL")
    parser.add_argument("--out-test", required=True, help="Output test JSONL")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        items.append(json.loads(line))
    return items


def ensure_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            return {}
    return {}


def build_example(
    row: dict[str, Any],
    tool_schemas: dict[str, dict[str, Any]],
) -> dict[str, Any] | None:
    if row.get("skip"):
        return None
    user_message = (row.get("user_message") or "").strip()
    tool_name = (row.get("label_tool_name") or "").strip()
    args = ensure_dict(row.get("label_arguments"))
    if not user_message or not tool_name:
        return None

    tool_schema = tool_schemas.get(tool_name)
    if not tool_schema:
        return None

    selected_tools = row.get("selected_tools") or []
    selected_schemas = [tool_schemas[name] for name in selected_tools if name in tool_schemas]
    if tool_schema not in selected_schemas:
        selected_schemas.append(tool_schema)

    return {
        "messages": [
            {"role": "developer", "content": DEFAULT_SYSTEM_MSG},
            {"role": "user", "content": user_message},
            {
                "role": "assistant",
                "tool_calls": [
                    {
                        "type": "function",
                        "function": {"name": tool_name, "arguments": args},
                    }
                ],
            },
        ],
        "tools": selected_schemas,
    }


def write_jsonl(path: Path, items: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=True) + "\n")


def main() -> None:
    args = parse_args()
    bundle = json.loads(Path(args.bundle).read_text(encoding="utf-8"))
    tools = bundle.get("tools") or []
    tool_schemas = {
        t.get("function", {}).get("name"): t
        for t in tools
        if isinstance(t, dict) and t.get("function", {}).get("name")
    }

    rows = read_jsonl(Path(args.annotations))
    examples: list[dict[str, Any]] = []
    for row in rows:
        ex = build_example(row, tool_schemas)
        if ex is not None:
            examples.append(ex)

    if not examples:
        raise SystemExit("No valid labeled examples found.")

    random.seed(args.seed)
    random.shuffle(examples)
    test_n = max(1, int(len(examples) * args.test_size))
    test = examples[:test_n]
    train = examples[test_n:]
    if not train:
        train, test = examples[:-1], examples[-1:]

    write_jsonl(Path(args.out_train), train)
    write_jsonl(Path(args.out_test), test)

    print(f"Train examples: {len(train)} -> {args.out_train}")
    print(f"Test examples: {len(test)} -> {args.out_test}")


if __name__ == "__main__":
    main()

