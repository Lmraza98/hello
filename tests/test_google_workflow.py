from services.google.workflows import (
    _build_human_typing_keystrokes,
    _extract_ai_overview,
    _extract_organic_results,
    _is_human_verification_page,
    _normalize_outbound_url,
)


def test_normalize_google_redirect_url():
    redirected = "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fpaper&sa=U&ved=2ah"
    assert _normalize_outbound_url(redirected) == "https://example.com/paper"


def test_extract_ai_overview_from_snapshot_text():
    snapshot = {
        "snapshot_text": "\n".join(
            [
                "Google Search",
                "AI Overview",
                "SOC 2 is an auditing standard for security and trust controls.",
                "It applies to service organizations handling customer data.",
                "People also ask",
            ]
        ),
        "refs": [
            {"label": "AICPA SOC 2", "href": "https://www.google.com/url?q=https%3A%2F%2Faicpa.org%2Fsoc2"},
            {"label": "Cloud Security Alliance", "href": "https://www.google.com/url?q=https%3A%2F%2Fcloudsecurityalliance.org"},
        ],
    }
    present, summary, citations = _extract_ai_overview(snapshot)
    assert present is True
    assert summary and "auditing standard" in summary
    assert len(citations) == 2
    assert citations[0]["url"].startswith("https://")


def test_extract_organic_results_filters_google_and_ads():
    snapshot = {
        "refs": [
            {"label": "SOC 2 Overview", "href": "https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fsoc2"},
            {"label": "Ad", "href": "https://www.google.com/url?q=https%3A%2F%2Fads.example"},
            {"label": "Google Account Help", "href": "https://support.google.com/accounts/"},
            {"label": "PCI DSS 4.0", "href": "https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fpci"},
        ]
    }
    rows = _extract_organic_results(snapshot, limit=5)
    assert len(rows) == 2
    assert rows[0]["rank"] == 1
    assert rows[0]["title"] == "SOC 2 Overview"
    assert rows[1]["url"] == "https://example.org/pci"


def test_human_keystrokes_with_typos_still_reconstructs_text():
    import random

    random.seed(7)
    target = "abc 12"
    keys = _build_human_typing_keystrokes(
        target,
        typo_enabled=True,
        typo_probability=0.5,
    )
    reconstructed: list[str] = []
    for key in keys:
        if key == "Backspace":
            if reconstructed:
                reconstructed.pop()
            continue
        if key == "Space":
            reconstructed.append(" ")
            continue
        reconstructed.append(key)
    assert "".join(reconstructed) == target


def test_detects_google_unusual_traffic_page():
    snapshot = {
        "url": "https://www.google.com/sorry/index?continue=https://www.google.com/search",
        "snapshot_text": "Our systems have detected unusual traffic from your computer network.",
    }
    assert _is_human_verification_page(snapshot) is True
