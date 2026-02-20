from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "launcher.py"


def _text() -> str:
    return SRC.read_text(encoding="utf-8")


def test_drawer_markup_exists():
    text = _text()
    assert 'id="testDrawer"' in text
    assert 'id="drawerTabs"' in text
    assert 'id="drawerBody"' in text


def test_keyboard_handlers_exist():
    text = _text()
    assert "event.key === 'Escape'" in text
    assert "event.key === '/'" in text
    assert "event.key === 'Enter'" in text


def test_assertions_progressive_disclosure_exists():
    text = _text()
    assert "drawerTab === 'assertions'" in text
    assert "Show ${a.detail.length - 2} more" in text


def test_search_filter_cases_exists():
    text = _text()
    assert "search cases or files" in text
    assert "caseSearchByTest[item.id]" in text
