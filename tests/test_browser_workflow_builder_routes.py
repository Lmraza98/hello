import asyncio
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.routes import browser_workflows as routes


def _run(coro):
    return asyncio.run(coro)


class _FakeWorkflow:
    def __init__(self, tab_id: str | None = None):
        self.tab_id = tab_id or "tab-fake"


def test_observation_pack_success(monkeypatch):
    monkeypatch.setattr(routes, "BrowserWorkflow", _FakeWorkflow)

    async def fake_build_observation_pack(_wf, **_kwargs):
        return {
            "url": "https://fixture.local/products",
            "domain": "fixture.local",
            "page_mode": "list",
            "dom": {"role_refs": [{"href": "https://fixture.local/products/1", "label": "Item 1", "role": "link"}]},
        }

    monkeypatch.setattr(routes, "build_observation_pack", fake_build_observation_pack)

    req = routes.ObservationPackRequest(tab_id="tab-1", include_screenshot=False, include_semantic_nodes=True)
    out = _run(routes.browser_observation_pack(req))
    assert out["ok"] is True
    assert out["tab_id"] == "tab-1"
    assert out["observation"]["domain"] == "fixture.local"


def test_validate_candidate_success(monkeypatch):
    monkeypatch.setattr(routes, "BrowserWorkflow", _FakeWorkflow)

    async def fake_build_observation_pack(_wf, **_kwargs):
        return {
            "url": "https://fixture.local/products",
            "domain": "fixture.local",
            "page_mode": "list",
            "dom": {
                "role_refs": [
                    {"href": "https://fixture.local/products/1", "label": "Product One", "role": "link", "landmark_role": "main", "container_hint": "article|c:result"},
                    {"href": "https://fixture.local/products/2", "label": "Product Two", "role": "link", "landmark_role": "main", "container_hint": "article|c:result"},
                    {"href": "https://fixture.local/help", "label": "Help", "role": "link", "landmark_role": "nav", "container_hint": "nav|c:menu"},
                ]
            },
        }

    monkeypatch.setattr(routes, "build_observation_pack", fake_build_observation_pack)

    req = routes.ValidateCandidateRequest(
        tab_id="tab-1",
        href_contains=["/products/"],
        label_contains_any=["product"],
        exclude_label_contains_any=["help"],
        role_allowlist=["link"],
        must_be_within_roles=["main"],
        exclude_within_roles=["nav"],
        container_hint_contains=["article|c:result"],
        min_items=1,
        max_items=20,
        required_fields=["name", "url"],
    )
    out = _run(routes.browser_validate_candidate(req))
    assert out["ok"] is True
    validation = out["candidate_validation"]
    assert validation["ok"] is True
    assert validation["metrics"]["count"] == 2
    assert isinstance(validation["fit_score"], (int, float))


def test_annotate_candidate_success(monkeypatch):
    monkeypatch.setattr(routes, "BrowserWorkflow", _FakeWorkflow)

    async def fake_build_annotation_artifacts(_wf, **_kwargs):
        return {
            "boxes": [
                {
                    "box_id": "b1",
                    "href": "https://fixture.local/products/1",
                    "label": "Product One",
                    "role": "link",
                }
            ],
            "screenshot_base64": "abc123",
        }

    monkeypatch.setattr(routes, "build_annotation_artifacts", fake_build_annotation_artifacts)

    req = routes.AnnotateCandidateRequest(tab_id="tab-1", href_contains=["/products/"], max_boxes=20, include_screenshot=True)
    out = _run(routes.browser_annotate_candidate(req))
    assert out["ok"] is True
    assert out["annotation"]["boxes"][0]["box_id"] == "b1"
    assert out["annotation"]["screenshot_base64"] == "abc123"


def test_synthesize_from_feedback_success(monkeypatch):
    monkeypatch.setattr(routes, "BrowserWorkflow", _FakeWorkflow)

    async def fake_build_observation_pack(_wf, **_kwargs):
        return {
            "url": "https://fixture.local/products",
            "domain": "fixture.local",
            "page_mode": "list",
            "dom": {
                "role_refs": [
                    {"href": "https://fixture.local/products/1", "label": "Product One", "role": "link", "landmark_role": "main", "container_hint": "article|c:result"},
                    {"href": "https://fixture.local/products/2", "label": "Product Two", "role": "link", "landmark_role": "main", "container_hint": "article|c:result"},
                    {"href": "https://fixture.local/help", "label": "Help", "role": "link", "landmark_role": "nav", "container_hint": "nav|c:menu"},
                ]
            },
        }

    monkeypatch.setattr(routes, "build_observation_pack", fake_build_observation_pack)

    boxes = [
        {
            "box_id": "b1",
            "href": "https://fixture.local/products/1",
            "label": "Product One",
            "role": "link",
            "landmark_role": "main",
            "container_hint": "article|c:result",
        },
        {
            "box_id": "b2",
            "href": "https://fixture.local/help",
            "label": "Help",
            "role": "link",
            "landmark_role": "nav",
            "container_hint": "nav|c:menu",
        },
    ]
    req = routes.FeedbackSynthesisRequest(
        tab_id="tab-1",
        boxes=boxes,
        include_box_ids=["b1"],
        exclude_box_ids=["b2"],
        fallback_href_contains=["/products/"],
        required_fields=["name", "url"],
        min_items=1,
        max_items=20,
    )
    out = _run(routes.browser_synthesize_from_feedback(req))
    assert out["ok"] is True
    assert out["suggested_href_contains"] == ["/products/"]
    assert out["feedback_stats"]["include_count"] == 1
    assert out["feedback_stats"]["exclude_count"] == 1
    assert out["candidate_validation"]["ok"] is True


@pytest.mark.parametrize(
    "fn_name, req_factory, patch_target",
    [
        ("browser_observation_pack", lambda: routes.ObservationPackRequest(tab_id="tab-1"), "build_observation_pack"),
        ("browser_validate_candidate", lambda: routes.ValidateCandidateRequest(tab_id="tab-1"), "build_observation_pack"),
        ("browser_annotate_candidate", lambda: routes.AnnotateCandidateRequest(tab_id="tab-1"), "build_annotation_artifacts"),
        ("browser_synthesize_from_feedback", lambda: routes.FeedbackSynthesisRequest(tab_id="tab-1"), "build_observation_pack"),
    ],
)
def test_builder_routes_raise_500_on_internal_error(monkeypatch, fn_name, req_factory, patch_target):
    monkeypatch.setattr(routes, "BrowserWorkflow", _FakeWorkflow)

    async def broken(*_args, **_kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(routes, patch_target, broken)

    with pytest.raises(HTTPException) as exc:
        _run(getattr(routes, fn_name)(req_factory()))
    assert exc.value.status_code == 500
    assert "boom" in str(exc.value.detail)
