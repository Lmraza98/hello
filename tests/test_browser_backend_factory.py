from services.web_automation.browser.backends.factory import get_browser_backend, reset_browser_backend_for_tests


def test_factory_selects_camoufox_backend(monkeypatch):
    monkeypatch.setenv("BROWSER_GATEWAY_MODE", "camoufox")
    reset_browser_backend_for_tests()
    backend = get_browser_backend()
    assert backend.__class__.__name__ == "CamoufoxBackend"


def test_factory_defaults_to_local_backend(monkeypatch):
    monkeypatch.delenv("BROWSER_GATEWAY_MODE", raising=False)
    reset_browser_backend_for_tests()
    backend = get_browser_backend()
    assert backend.__class__.__name__ == "LocalPlaywrightBackend"


def test_factory_selection_ignores_workflow_async_env(monkeypatch):
    monkeypatch.setenv("BROWSER_GATEWAY_MODE", "leadpilot")
    monkeypatch.setenv("BROWSER_WORKFLOW_ASYNC_ENABLED", "true")
    reset_browser_backend_for_tests()
    backend = get_browser_backend()
    assert backend.__class__.__name__ == "LeadPilotBackend"
