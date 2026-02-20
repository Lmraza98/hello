import socket
from pathlib import Path

import pytest

from launcher_runtime.supervisor import LauncherStartupError, ProcessSupervisor


def test_preflight_detects_port_conflict(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    app_dir = tmp_path / "app"
    (app_dir / "scripts").mkdir(parents=True)
    (app_dir / "scripts" / "leadpilot_browser_bridge.ts").write_text("// bridge", encoding="utf-8")
    fake_node = app_dir / "runtime" / "node" / "node"
    fake_node.parent.mkdir(parents=True)
    fake_node.write_text("", encoding="utf-8")

    monkeypatch.setenv("LEADPILOT_NODE_PATH", str(fake_node))
    sup = ProcessSupervisor(app_dir=app_dir, server_port=18001, bridge_port=18002)

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 18001))
    sock.listen(1)

    try:
        with pytest.raises(LauncherStartupError) as exc:
            sup.preflight(tmp_path / "runs")
        assert exc.value.code == "port_conflict"
    finally:
        sock.close()
