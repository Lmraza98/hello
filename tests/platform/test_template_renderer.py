import importlib.util
from pathlib import Path


_MODULE_PATH = Path(__file__).resolve().parents[2] / "services" / "email" / "template_renderer.py"
_SPEC = importlib.util.spec_from_file_location("template_renderer", _MODULE_PATH)
_MOD = importlib.util.module_from_spec(_SPEC)
assert _SPEC and _SPEC.loader
_SPEC.loader.exec_module(_MOD)

render_text = _MOD.render_text
extract_unknown_tokens = _MOD.extract_unknown_tokens
validate_rendered_output = _MOD.validate_rendered_output


def test_render_fallback_token():
    rendered = render_text('Hi {{firstName | "there"}}', {"firstName": ""})
    assert rendered == "Hi there"


def test_unknown_token_detection():
    unknown = extract_unknown_tokens("Hello {{firstName}} {{notRealToken}}")
    assert "notRealToken" in unknown


def test_unsubscribe_validation_error():
    result = validate_rendered_output("Subject", "<p>Hello world</p>", "sender@example.com")
    assert any("unsubscribe" in err.lower() for err in result["errors"])
