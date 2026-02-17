from __future__ import annotations

import argparse
import json
from pathlib import Path


def _tail_lines(path: Path, n: int) -> list[str]:
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return lines[-max(1, n) :]


def main() -> int:
    parser = argparse.ArgumentParser(description="Show recent challenge resolver events.")
    parser.add_argument(
        "--path",
        default="data/logs/challenge_resolver_events.jsonl",
        help="Path to challenge JSONL log",
    )
    parser.add_argument("--tail", type=int, default=30, help="Number of recent rows")
    args = parser.parse_args()

    path = Path(args.path)
    rows = _tail_lines(path, args.tail)
    if not rows:
        print(f"No events found at {path}")
        return 0

    print(f"Showing {len(rows)} most recent challenge events from {path}")
    for line in rows:
        try:
            obj = json.loads(line)
        except Exception:
            print(line)
            continue
        ts = str(obj.get("timestamp") or "")
        event = str(obj.get("event") or "")
        url = str(obj.get("url") or "")
        reason = str(obj.get("reason") or "")
        challenge = obj.get("challenge") if isinstance(obj.get("challenge"), dict) else {}
        kind = str(challenge.get("kind") or "")
        provider = str(challenge.get("provider") or "")
        variant = str(challenge.get("variant") or "")
        resolved = obj.get("resolved")
        ai = obj.get("ai") if isinstance(obj.get("ai"), dict) else {}
        ai_reason = str(ai.get("reason") or "")
        ticket = ""
        handoff = obj.get("handoff") if isinstance(obj.get("handoff"), dict) else {}
        if handoff:
            ticket = str(handoff.get("ticket_id") or "")
        print(
            f"{ts} event={event} kind={kind} provider={provider} variant={variant} "
            f"resolved={resolved} reason={reason or ai_reason} ticket={ticket} url={url}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
