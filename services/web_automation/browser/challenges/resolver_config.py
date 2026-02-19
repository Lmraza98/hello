from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "y", "on"}


def _env_int(name: str, default: int, *, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)) or str(default))
    except Exception:
        value = default
    return max(minimum, min(maximum, value))


def _env_csv(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default) or default
    return [x.strip().lower() for x in raw.split(",") if x.strip()]


@dataclass(frozen=True)
class ChallengeResolverConfig:
    enabled: bool
    research_mode: bool
    allow_live_hosts: bool
    allowed_hosts: list[str]
    ai_enabled: bool
    ai_model: str
    ai_max_rounds: int
    ai_max_actions_per_round: int
    human_fallback_enabled: bool
    human_wait_timeout_ms: int
    human_poll_interval_ms: int
    log_jsonl_path: Path
    handoff_dir: Path
    notify_webhook_url: str | None

    @classmethod
    def from_env(cls) -> "ChallengeResolverConfig":
        base_log_path = Path(
            os.getenv("CHALLENGE_RESOLVER_LOG_PATH", "data/logs/challenge_resolver_events.jsonl")
        )
        handoff_dir = Path(
            os.getenv("CHALLENGE_RESOLVER_HANDOFF_DIR", "data/logs/challenge_handoffs")
        )
        return cls(
            enabled=_env_bool("CHALLENGE_RESOLVER_ENABLED", True),
            research_mode=_env_bool("CHALLENGE_RESEARCH_MODE", False),
            allow_live_hosts=_env_bool("CHALLENGE_ALLOW_LIVE_HOSTS", False),
            allowed_hosts=_env_csv(
                "CHALLENGE_RESEARCH_ALLOWED_HOSTS",
                "localhost,127.0.0.1,::1",
            ),
            ai_enabled=_env_bool("CHALLENGE_AI_ENABLED", False),
            ai_model=(os.getenv("CHALLENGE_AI_MODEL", "gpt-4o-mini") or "gpt-4o-mini").strip(),
            ai_max_rounds=_env_int("CHALLENGE_AI_MAX_ROUNDS", 2, minimum=1, maximum=8),
            ai_max_actions_per_round=_env_int("CHALLENGE_AI_MAX_ACTIONS", 5, minimum=1, maximum=20),
            human_fallback_enabled=_env_bool("CHALLENGE_HUMAN_FALLBACK_ENABLED", True),
            human_wait_timeout_ms=_env_int(
                "CHALLENGE_HUMAN_WAIT_TIMEOUT_MS",
                180_000,
                minimum=5_000,
                maximum=3_600_000,
            ),
            human_poll_interval_ms=_env_int(
                "CHALLENGE_HUMAN_POLL_INTERVAL_MS",
                1_500,
                minimum=250,
                maximum=60_000,
            ),
            log_jsonl_path=base_log_path,
            handoff_dir=handoff_dir,
            notify_webhook_url=(os.getenv("CHALLENGE_HUMAN_NOTIFY_WEBHOOK_URL", "").strip() or None),
        )

    def host_allowed(self, url: str | None) -> bool:
        if self.allow_live_hosts:
            return True
        host = (urlparse(url or "").hostname or "").strip().lower()
        if not host:
            return False
        for allowed in self.allowed_hosts:
            if host == allowed or host.endswith(f".{allowed}"):
                return True
        return False

    def feature_enabled_for_url(self, url: str | None) -> bool:
        if not self.enabled:
            return False
        if not self.research_mode:
            return False
        return self.host_allowed(url)


def append_jsonl(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=True) + "\n")
