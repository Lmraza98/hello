from pathlib import Path
import shutil
import uuid

from services.web_automation.browser.skills import store
from services.web_automation.browser.workflows.recipes import _evaluate_item_validation


def test_fingerprint_roundtrip():
    observation = {
        "url": "https://weather.com/weather/today/l/12345",
        "dom": {
            "role_refs": [
                {"role": "link"},
                {"role": "link"},
                {"role": "heading"},
                {"role": "button"},
            ],
            "semantic_nodes": [
                {"landmark_role": "main"},
                {"landmark_role": "main"},
                {"landmark_role": "navigation"},
            ],
        },
    }
    fp = store.build_observation_fingerprint(observation)
    text = store.serialize_fingerprint(fp)
    parsed = store.parse_fingerprint(text)
    assert parsed["url_pattern"]
    assert "link" in parsed["top_roles"]
    assert "main" in parsed["top_landmarks"]


def test_match_skill_prefers_fingerprint(monkeypatch):
    test_dir = Path("data") / f"test_tmp_skills_fp_{uuid.uuid4().hex[:8]}"
    test_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(store, "SKILLS_DIR", test_dir)
    monkeypatch.setattr(store, "ensure_seed_skills", lambda: None)

    obs = {
        "url": "https://weather.com/weather/today/l/12345",
        "dom": {
            "role_refs": [{"role": "link"}, {"role": "heading"}, {"role": "link"}],
            "semantic_nodes": [{"landmark_role": "main"}, {"landmark_role": "navigation"}],
        },
    }
    fp_good = store.serialize_fingerprint(store.build_observation_fingerprint(obs))
    fp_bad = "url=example.com/search;roles=button,input;landmarks=nav"

    content_good = f"""---
name: Weather Good
description: Fingerprint matched
domains:
  - weather.com
tasks:
  - weather_extract
tags:
  - weather
fingerprints:
  - {fp_good}
version: 1
---

# Weather Good
"""
    content_bad = f"""---
name: Weather Bad
description: Fingerprint mismatched
domains:
  - weather.com
tasks:
  - weather_extract
tags:
  - weather
fingerprints:
  - {fp_bad}
version: 1
---

# Weather Bad
"""
    store.upsert_skill("weather-good", content_good)
    store.upsert_skill("weather-bad", content_bad)

    matched = store.match_skill(
        url="https://weather.com/weather/today/l/12345",
        task="weather_extract",
        query="weather",
        observation=obs,
    )
    assert matched
    assert matched["skill_id"] == "weather-good"
    shutil.rmtree(test_dir, ignore_errors=True)


def test_item_validation_detects_uniqueness_failure():
    items = [
        {"name": "A", "url": "https://example.com/a"},
        {"name": "B", "url": "https://example.com/a"},
        {"name": "C", "url": "https://example.com/a"},
    ]
    result = _evaluate_item_validation(
        items=items,
        name_field="name",
        url_field="url",
        min_items=1,
        max_items=10,
        required_fields=["name", "url"],
        min_unique_url_fraction=0.8,
    )
    assert result["ok"] is False
    assert "low_unique_url_fraction" in result["reasons"]
