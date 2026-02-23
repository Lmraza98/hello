from pathlib import Path


SRC_APP = Path(__file__).resolve().parents[2] / "launcher_frontend" / "src" / "App.jsx"
SRC_GRAPH = Path(__file__).resolve().parents[2] / "launcher_frontend" / "src" / "components" / "graph" / "TestDependencyGraph.tsx"
SRC_DETAILS = Path(__file__).resolve().parents[2] / "launcher_frontend" / "src" / "components" / "DetailsPane.jsx"


def _text() -> str:
    return "\n".join(
        [
            SRC_APP.read_text(encoding="utf-8"),
            SRC_GRAPH.read_text(encoding="utf-8"),
            SRC_DETAILS.read_text(encoding="utf-8"),
        ]
    )


def test_drawer_markup_exists():
    text = _text()
    assert "setDrawerOpen" in text
    assert "DetailsPane" in text
    assert "drawerOpen" in text


def test_keyboard_handlers_exist():
    text = _text()
    assert "event.key === \"Escape\"" in text
    assert "event.key === \"/\"" in text
    assert "event.key === \"Enter\"" in text


def test_assertions_progressive_disclosure_exists():
    text = _text()
    assert "traceTab === \"evidence\"" in text or "traceTab === \"overview\"" in text
    assert "Run Inspector (dev)" in text


def test_search_filter_cases_exists():
    text = _text()
    assert "search cases" in text.lower()
    assert "setSearch(" in text
