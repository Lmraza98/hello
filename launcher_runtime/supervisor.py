from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests


class LauncherStartupError(RuntimeError):
    def __init__(self, code: str, message: str, remediation: str = ""):
        super().__init__(message)
        self.code = code
        self.message = message
        self.remediation = remediation


@dataclass(slots=True)
class ProcessInfo:
    name: str
    command: list[str]
    process: subprocess.Popen[str]


class ProcessSupervisor:
    def __init__(self, app_dir: Path, server_port: int, bridge_port: int):
        self.app_dir = app_dir
        self.server_port = server_port
        self.bridge_port = bridge_port
        self.processes: dict[str, ProcessInfo] = {}

    def node_path(self) -> str:
        env_path = os.getenv("LEADPILOT_NODE_PATH")
        if env_path:
            return env_path
        bundled = self.app_dir / "runtime" / "node" / ("node.exe" if sys.platform.startswith("win") else "node")
        if bundled.exists():
            return str(bundled)
        return "node"

    def bridge_command(self) -> list[str]:
        return [
            self.node_path(),
            "--import",
            "tsx",
            str(self.app_dir / "scripts" / "leadpilot_browser_bridge.ts"),
        ]

    def backend_command(self) -> list[str]:
        return [
            sys.executable,
            "-m",
            "uvicorn",
            "api.main:app",
            "--host",
            "127.0.0.1",
            "--port",
            str(self.server_port),
        ]

    def preflight(self, run_store_root: Path) -> dict[str, Any]:
        checks: dict[str, Any] = {"ok": True, "issues": []}
        bridge_script = self.app_dir / "scripts" / "leadpilot_browser_bridge.ts"
        allow_attach_backend = os.getenv("LAUNCHER_ATTACH_EXISTING_BACKEND", "").strip().lower() in {"1", "true", "yes"}
        allow_attach_bridge = os.getenv("LAUNCHER_ATTACH_EXISTING_BRIDGE", "").strip().lower() in {"1", "true", "yes"}
        checks["attach_existing_backend"] = False
        checks["attach_existing_bridge"] = False

        # Port conflicts must win over dependency checks so startup diagnostics
        # and tests consistently classify bind failures as port_conflict.
        for port, name in ((self.server_port, "backend"), (self.bridge_port, "bridge")):
            if self._port_in_use(port):
                if name == "backend" and allow_attach_backend and self._backend_is_healthy():
                    checks["attach_existing_backend"] = True
                    continue
                if name == "bridge" and allow_attach_bridge and self._bridge_is_healthy():
                    checks["attach_existing_bridge"] = True
                    continue
                raise LauncherStartupError(
                    "port_conflict",
                    f"{name} port is already in use: {port}",
                    f"Stop existing process on {port} or change env port for {name}.",
                )

        if not bridge_script.exists():
            raise LauncherStartupError(
                "missing_dependency",
                f"missing bridge script: {bridge_script}",
                "Restore scripts/leadpilot_browser_bridge.ts or rebuild package assets.",
            )

        node_bin = self.node_path()
        if node_bin == "node":
            # best-effort check path-resolved node exists
            try:
                subprocess.run(["node", "--version"], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception as exc:
                raise LauncherStartupError(
                    "missing_dependency",
                    "node executable not found",
                    "Install Node.js or set LEADPILOT_NODE_PATH.",
                ) from exc
        elif not Path(node_bin).exists():
            raise LauncherStartupError(
                "missing_dependency",
                f"configured node path does not exist: {node_bin}",
                "Fix LEADPILOT_NODE_PATH or bundle runtime/node.",
            )

        # Ensure the tsx loader used by bridge_command is resolvable by node.
        try:
            subprocess.run(
                [self.node_path(), "--import", "tsx", "-e", "console.log('tsx-ok')"],
                cwd=self.app_dir,
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as exc:
            raise LauncherStartupError(
                "missing_dependency",
                "tsx loader not available for node bridge startup",
                "Run `npm install` in repo root (where package.json defines tsx), then retry `python launcher.py`.",
            ) from exc

        run_store_root.mkdir(parents=True, exist_ok=True)
        probe = run_store_root / ".probe"
        try:
            probe.write_text("ok", encoding="utf-8")
            probe.unlink(missing_ok=True)
        except Exception as exc:
            raise LauncherStartupError(
                "missing_dependency",
                f"run store path not writable: {run_store_root}",
                "Ensure write permissions for data/launcher_runs.",
            ) from exc

        return checks

    def start_process(self, name: str, command: list[str], retries: int = 2) -> subprocess.Popen[str]:
        last_error: Exception | None = None
        for _ in range(retries + 1):
            try:
                proc = subprocess.Popen(
                    command,
                    cwd=self.app_dir,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                )
                self.processes[name] = ProcessInfo(name=name, command=command, process=proc)
                return proc
            except Exception as exc:
                last_error = exc
                time.sleep(0.3)

        raise LauncherStartupError(
            "missing_dependency",
            f"failed to start {name}: {last_error}",
            "Verify dependencies and command paths.",
        )

    def wait_for_backend_ready(self, timeout: float = 20.0) -> bool:
        url = f"http://127.0.0.1:{self.server_port}/api/stats"
        end = time.time() + timeout
        while time.time() < end:
            try:
                res = requests.get(url, timeout=1)
                if res.status_code == 200:
                    return True
            except Exception:
                pass
            time.sleep(0.3)
        return False

    def wait_for_bridge_ready(self, timeout: float = 20.0) -> bool:
        url = f"http://127.0.0.1:{self.bridge_port}/tabs"
        end = time.time() + timeout
        while time.time() < end:
            try:
                res = requests.get(url, timeout=1)
                if 200 <= res.status_code < 500:
                    return True
            except Exception:
                pass
            time.sleep(0.3)
        return False

    def status(self) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for name, info in self.processes.items():
            out[name] = {
                "pid": info.process.pid,
                "alive": info.process.poll() is None,
                "returncode": info.process.poll(),
                "command": info.command,
            }
        return out

    def shutdown(self) -> None:
        for info in self.processes.values():
            try:
                info.process.terminate()
            except Exception:
                pass

    @staticmethod
    def _port_in_use(port: int) -> bool:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            return s.connect_ex(("127.0.0.1", port)) == 0

    def _backend_is_healthy(self) -> bool:
        url = f"http://127.0.0.1:{self.server_port}/api/stats"
        try:
            res = requests.get(url, timeout=1.2)
            return res.status_code == 200
        except Exception:
            return False

    def _bridge_is_healthy(self) -> bool:
        url = f"http://127.0.0.1:{self.bridge_port}/tabs"
        try:
            res = requests.get(url, timeout=1.2)
            return 200 <= res.status_code < 500
        except Exception:
            return False
