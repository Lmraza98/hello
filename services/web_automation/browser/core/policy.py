"""General constrained-agent policy for browser workflows.

This module intentionally avoids browser fingerprint patching. It focuses on:
- explicit state tracking for workflow progression,
- bounded action rates via token buckets,
- session-level action budgets and cooldowns.
"""

from __future__ import annotations

import os
import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from typing import Deque


class AgentState(str, Enum):
    AUTH_CHECK = "auth_check"
    HOME_READY = "home_ready"
    SEARCH = "search"
    COMPANY_PAGE = "company_page"
    RESULTS_READY = "results_ready"
    EXTRACT = "extract"
    DONE = "done"
    RECOVERY = "recovery"


@dataclass
class TokenBucket:
    rate_per_sec: float
    capacity: float
    tokens: float | None = None
    last_refill_ts: float = field(default_factory=time.monotonic)

    def __post_init__(self) -> None:
        if self.tokens is None:
            self.tokens = self.capacity

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = max(0.0, now - self.last_refill_ts)
        self.last_refill_ts = now
        self.tokens = min(self.capacity, float(self.tokens or 0.0) + elapsed * self.rate_per_sec)

    def consume(self, cost: float = 1.0) -> bool:
        self._refill()
        if float(self.tokens or 0.0) >= cost:
            self.tokens = float(self.tokens or 0.0) - cost
            return True
        return False

    def wait_seconds_for(self, cost: float = 1.0) -> float:
        self._refill()
        missing = max(0.0, cost - float(self.tokens or 0.0))
        if missing <= 0:
            return 0.0
        if self.rate_per_sec <= 0:
            return 60.0
        return missing / self.rate_per_sec


@dataclass
class BrowserPolicyConfig:
    enabled: bool = True
    max_actions_per_hour: int = 240
    cooldown_after_friction_ms: int = 1500

    nav_rate_per_sec: float = 1.0 / 8.0
    nav_capacity: float = 3.0

    click_rate_per_sec: float = 1.0 / 1.2
    click_capacity: float = 8.0

    type_rate_per_sec: float = 1.0 / 1.0
    type_capacity: float = 8.0

    tab_rate_per_sec: float = 1.0 / 10.0
    tab_capacity: float = 2.0

    @classmethod
    def from_env(cls) -> "BrowserPolicyConfig":
        def _f(name: str, default: float) -> float:
            try:
                return float(os.getenv(name, str(default)))
            except Exception:
                return default

        def _i(name: str, default: int) -> int:
            try:
                return int(os.getenv(name, str(default)))
            except Exception:
                return default

        def _b(name: str, default: bool) -> bool:
            raw = os.getenv(name, "true" if default else "false").strip().lower()
            return raw in {"1", "true", "yes", "on"}

        return cls(
            enabled=_b("BROWSER_POLICY_ENABLED", True),
            max_actions_per_hour=_i("BROWSER_MAX_ACTIONS_PER_HOUR", 240),
            cooldown_after_friction_ms=_i("BROWSER_COOLDOWN_AFTER_FRICTION_MS", 1500),
            nav_rate_per_sec=_f("BROWSER_NAV_RATE_PER_SEC", 1.0 / 8.0),
            nav_capacity=_f("BROWSER_NAV_CAPACITY", 3.0),
            click_rate_per_sec=_f("BROWSER_CLICK_RATE_PER_SEC", 1.0 / 1.2),
            click_capacity=_f("BROWSER_CLICK_CAPACITY", 8.0),
            type_rate_per_sec=_f("BROWSER_TYPE_RATE_PER_SEC", 1.0 / 1.0),
            type_capacity=_f("BROWSER_TYPE_CAPACITY", 8.0),
            tab_rate_per_sec=_f("BROWSER_TAB_RATE_PER_SEC", 1.0 / 10.0),
            tab_capacity=_f("BROWSER_TAB_CAPACITY", 2.0),
        )


class BrowserPolicy:
    def __init__(self, config: BrowserPolicyConfig | None = None):
        self.config = config or BrowserPolicyConfig.from_env()
        self.state: AgentState = AgentState.AUTH_CHECK
        self._actions: Deque[float] = deque()
        self._cooldown_until = 0.0
        self._buckets = {
            "navigate": TokenBucket(self.config.nav_rate_per_sec, self.config.nav_capacity),
            "click": TokenBucket(self.config.click_rate_per_sec, self.config.click_capacity),
            "type": TokenBucket(self.config.type_rate_per_sec, self.config.type_capacity),
            "tab": TokenBucket(self.config.tab_rate_per_sec, self.config.tab_capacity),
        }

    def transition(self, new_state: AgentState) -> None:
        self.state = new_state

    def note_friction(self) -> None:
        cooldown_s = max(0.0, self.config.cooldown_after_friction_ms / 1000.0)
        self._cooldown_until = max(self._cooldown_until, time.monotonic() + cooldown_s)

    def _prune_action_window(self) -> None:
        now = time.monotonic()
        hour_ago = now - 3600.0
        while self._actions and self._actions[0] < hour_ago:
            self._actions.popleft()

    def _record_action(self) -> None:
        self._actions.append(time.monotonic())
        self._prune_action_window()

    def wait_seconds_for(self, action_type: str) -> float:
        if not self.config.enabled:
            return 0.0

        now = time.monotonic()
        wait = max(0.0, self._cooldown_until - now)

        self._prune_action_window()
        if len(self._actions) >= max(1, self.config.max_actions_per_hour):
            oldest = self._actions[0]
            wait = max(wait, (oldest + 3600.0) - now)

        bucket = self._buckets.get(action_type)
        if bucket is not None:
            wait = max(wait, bucket.wait_seconds_for(1.0))

        return wait

    def consume(self, action_type: str) -> bool:
        if not self.config.enabled:
            return True

        now = time.monotonic()
        if now < self._cooldown_until:
            return False

        self._prune_action_window()
        if len(self._actions) >= max(1, self.config.max_actions_per_hour):
            return False

        bucket = self._buckets.get(action_type)
        if bucket is not None and not bucket.consume(1.0):
            return False

        self._record_action()
        return True
