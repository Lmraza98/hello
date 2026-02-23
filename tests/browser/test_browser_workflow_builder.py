from services.web_automation.browser.workflows.builder import (
    classify_page_mode,
    infer_href_pattern,
    synthesize_candidate_from_feedback,
    synthesize_href_pattern_from_feedback,
    validate_extraction_candidate,
)


def test_classify_page_mode_login_wall():
    refs = [
        {"role": "button", "label": "Sign in", "href": ""},
        {"role": "input", "label": "Email", "href": ""},
    ]
    mode = classify_page_mode(url="https://example.com/login", refs=refs, snapshot_text="Sign in to continue")
    assert mode == "login_wall"


def test_infer_href_pattern_picks_stable_segment():
    refs = [
        {"href": "https://github.com/org/repo1", "label": "repo1"},
        {"href": "https://github.com/org/repo2", "label": "repo2"},
        {"href": "https://github.com/org/repo3", "label": "repo3"},
    ]
    pattern = infer_href_pattern(refs)
    assert pattern == "/org/"


def test_validate_extraction_candidate_scores_good_candidate():
    refs = [
        {"href": "https://example.com/items/1", "label": "Item 1"},
        {"href": "https://example.com/items/2", "label": "Item 2"},
        {"href": "https://example.com/items/3", "label": "Item 3"},
    ]
    result = validate_extraction_candidate(
        refs,
        href_contains=["/items/"],
        min_items=1,
        max_items=20,
        required_fields=["name", "url"],
        base_domain="example.com",
    )
    assert result["ok"] is True
    assert result["fit_score"] >= 70
    assert result["metrics"]["count"] == 3


def test_validate_extraction_candidate_rejects_missing_urls():
    refs = [
        {"href": "", "label": "Item 1"},
        {"href": "", "label": "Item 2"},
    ]
    result = validate_extraction_candidate(
        refs,
        href_contains=[],
        min_items=1,
        max_items=10,
        required_fields=["name", "url"],
    )
    assert result["ok"] is False
    assert result["metrics"]["url_non_empty_rate"] == 0.0


def test_synthesize_href_pattern_from_feedback_prefers_positive_segment():
    pattern = synthesize_href_pattern_from_feedback(
        include_hrefs=[
            "https://example.com/products/1",
            "https://example.com/products/2",
            "https://example.com/products/3",
        ],
        exclude_hrefs=[
            "https://example.com/blog/1",
            "https://example.com/help/contact",
        ],
        fallback_patterns=["/items/"],
    )
    assert pattern == "/products/"


def test_synthesize_href_pattern_from_feedback_uses_fallback_without_positives():
    pattern = synthesize_href_pattern_from_feedback(
        include_hrefs=[],
        exclude_hrefs=["https://example.com/blog/1"],
        fallback_patterns=["/items/"],
    )
    assert pattern == "/items/"


def test_synthesize_candidate_from_feedback_infers_label_and_role_constraints():
    candidate = synthesize_candidate_from_feedback(
        include_boxes=[
            {"href": "https://example.com/products/1", "label": "Weather forecast today", "role": "link", "landmark_role": "main", "container_hint": "article|c:result.card"},
            {"href": "https://example.com/products/2", "label": "Weather forecast hourly", "role": "link", "landmark_role": "main", "container_hint": "article|c:result.card"},
            {"href": "https://example.com/products/3", "label": "Weather forecast weekly", "role": "link", "landmark_role": "main", "container_hint": "article|c:result.card"},
        ],
        exclude_boxes=[
            {"href": "https://example.com/help/contact", "label": "Help center", "role": "button", "landmark_role": "nav", "container_hint": "nav|c:menu.item"},
            {"href": "https://example.com/help/privacy", "label": "Help policy", "role": "button", "landmark_role": "nav", "container_hint": "nav|c:menu.item"},
        ],
        fallback_patterns=["/items/"],
    )
    assert candidate["href_contains"] == ["/products/"]
    assert "weather" in candidate["label_contains_any"]
    assert "forecast" in candidate["label_contains_any"]
    assert "help" in candidate["exclude_label_contains_any"]
    assert candidate["role_allowlist"] == ["link"]
    assert candidate["must_be_within_roles"] == ["main"]
    assert candidate["exclude_within_roles"] == ["nav"]
    assert candidate["container_hint_contains"] == ["article|c:result.card"]
    assert candidate["exclude_container_hint_contains"] == ["nav|c:menu.item"]


def test_validate_extraction_candidate_applies_label_and_role_constraints():
    refs = [
        {"href": "https://example.com/weather/1", "label": "Weather forecast today", "role": "link", "landmark_role": "main", "container_hint": "article|c:result.card"},
        {"href": "https://example.com/weather/2", "label": "Weather forecast tonight", "role": "link", "landmark_role": "main", "container_hint": "article|c:result.card"},
        {"href": "https://example.com/weather/3", "label": "Weather forecast weekend", "role": "link", "landmark_role": "main", "container_hint": "article|c:result.card"},
        {"href": "https://example.com/weather/4", "label": "Help forecast", "role": "link", "landmark_role": "nav", "container_hint": "nav|c:menu.item"},
        {"href": "https://example.com/weather/5", "label": "Weather forecast card", "role": "button", "landmark_role": "main", "container_hint": "article|c:result.card"},
    ]
    result = validate_extraction_candidate(
        refs,
        href_contains=["/weather/"],
        label_contains_any=["weather", "forecast"],
        exclude_label_contains_any=["help"],
        role_allowlist=["link"],
        must_be_within_roles=["main"],
        exclude_within_roles=["nav"],
        container_hint_contains=["article|c:result.card"],
        exclude_container_hint_contains=["nav|c:menu.item"],
        min_items=1,
        max_items=20,
        required_fields=["name", "url"],
        base_domain="example.com",
    )
    assert result["ok"] is True
    assert result["metrics"]["count"] == 3
