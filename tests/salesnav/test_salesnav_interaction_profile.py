import asyncio
import random

from services.web_automation.linkedin.salesnav.core import interaction


def _run(coro):
    return asyncio.run(coro)


class _FakeMouse:
    def __init__(self):
        self.moves = []
        self.clicks = []
        self.wheels = []

    async def move(self, x, y, steps=1):
        self.moves.append((float(x), float(y), int(steps)))

    async def click(self, x, y):
        self.clicks.append((float(x), float(y)))

    async def wheel(self, dx, dy):
        self.wheels.append((int(dx), int(dy)))


class _FakePage:
    def __init__(self, width=1400, height=900):
        self.viewport_size = {"width": width, "height": height}
        self.mouse = _FakeMouse()


class _FakeLocator:
    def __init__(self, box):
        self._box = box
        self.scroll_calls = 0
        self.wait_calls = []

    @property
    def first(self):
        return self

    async def wait_for(self, **kwargs):
        self.wait_calls.append(kwargs)

    async def bounding_box(self):
        return dict(self._box)

    async def scroll_into_view_if_needed(self, **_kwargs):
        self.scroll_calls += 1


def test_runtime_profile_bounds_contract():
    profile = interaction._build_runtime_profile(rng=random.Random(7))
    assert 1280.0 <= float(profile["default_width"]) <= 2560.0
    assert 720.0 <= float(profile["default_height"]) <= 1440.0
    assert 3000 <= int(profile["visible_timeout_ms"]) <= 12000
    assert 3000 <= int(profile["attached_timeout_ms"]) <= 12000
    assert 0.02 <= float(profile["wait_min_s"]) <= float(profile["wait_max_s"]) <= 18.0
    assert 0.08 <= float(profile["click_inner_low_ratio"]) < float(profile["click_inner_high_ratio"]) <= 0.94
    assert 80 <= int(profile["wheel_chunk_px"]) <= 180
    assert 1 <= int(profile["idle_move_min_steps"]) <= int(profile["idle_move_max_steps"]) <= 6


def test_profile_is_cached_per_page_identity():
    interaction._page_profiles.clear()
    p1 = _FakePage()
    p2 = _FakePage()
    prof_a = interaction._profile_for_page(p1)
    prof_b = interaction._profile_for_page(p1)
    prof_c = interaction._profile_for_page(p2)
    assert prof_a is prof_b
    assert prof_c is not prof_a


def test_click_locator_uses_inner_ratio_profile(monkeypatch):
    interaction._mouse_pos.clear()
    interaction._page_profiles.clear()
    page = _FakePage(width=1200, height=800)
    locator = _FakeLocator({"x": 100, "y": 200, "width": 50, "height": 30})
    profile = interaction._build_runtime_profile(rng=random.Random(0))
    profile["click_inner_low_ratio"] = 0.2
    profile["click_inner_high_ratio"] = 0.8
    interaction._set_profile_for_testing(page, profile)

    async def _no_wait(*_args, **_kwargs):
        return 0.0

    monkeypatch.setattr(interaction, "wait_with_jitter", _no_wait)
    monkeypatch.setattr(interaction.random, "uniform", lambda low, high: (low + high) / 2.0)

    _run(interaction.click_locator(page, locator))
    assert locator.wait_calls
    assert page.mouse.clicks
    click_x, click_y = page.mouse.clicks[0]
    assert click_x == 125.0
    assert click_y == 215.0


def test_idle_drift_clamps_pointer_to_viewport(monkeypatch):
    interaction._mouse_pos.clear()
    interaction._page_profiles.clear()
    page = _FakePage(width=300, height=180)
    profile = interaction._build_runtime_profile(rng=random.Random(0))
    profile["default_padding"] = 10.0
    profile["idle_interval_mean_s"] = 0.05
    profile["idle_interval_std_s"] = 0.0
    profile["idle_interval_min_s"] = 0.01
    profile["idle_interval_max_s"] = 0.05
    profile["idle_drift_std_px"] = 200.0
    profile["idle_move_min_steps"] = 1
    profile["idle_move_max_steps"] = 1
    interaction._set_profile_for_testing(page, profile)

    async def _no_wait(*_args, **_kwargs):
        return 0.0

    monkeypatch.setattr(interaction, "wait_with_jitter", _no_wait)
    monkeypatch.setattr(interaction.random, "gauss", lambda _mean, _std: 1000.0)

    _run(interaction.idle_drift(page, duration_seconds=0.16))
    assert page.mouse.moves
    for x, y, _steps in page.mouse.moves:
        assert 10.0 <= x <= 290.0
        assert 10.0 <= y <= 170.0
