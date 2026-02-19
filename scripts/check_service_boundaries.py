"""Enforce import boundaries for `services/`.

Usage:
    python scripts/check_service_boundaries.py
"""

from __future__ import annotations

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]
SERVICES_DIR = ROOT / "services"
SCAN_PATHS = [
    ROOT / "services",
    ROOT / "api",
    ROOT / "scripts",
    ROOT / "tests",
    ROOT / "database.py",
    ROOT / "main.py",
    ROOT / "app.py",
]

IMPORT_RE = re.compile(r"^\s*(?:from|import)\s+services\.([a-zA-Z_][\w.]*)")

DEPRECATED_ROOTS = {
    "browser_backends",
    "browser_skills",
    "browser_workflows",
    "browser_workflow",
    "browser_policy",
    "browser_stealth",
    "challenge_detector",
    "challenge_handler",
    "challenge_resolver_config",
    "ai_challenge_resolver",
    "browser_challenges",
    "linkedin",
    "google",
    "salesforce",
    "workflows",
    "compound_workflow",
    "runners",
    "phone",
}


def _module_path(file_path: Path) -> str:
    return ".".join(file_path.relative_to(ROOT).with_suffix("").parts)


def _service_subdomain(file_path: Path) -> tuple[str, str]:
    parts = file_path.relative_to(SERVICES_DIR).parts
    root = parts[0]
    sub = parts[1] if len(parts) > 1 else ""
    return root, sub


def _iter_py_files() -> list[Path]:
    files: list[Path] = []
    seen: set[Path] = set()
    for path in SCAN_PATHS:
        if not path.exists():
            continue
        if path.is_file():
            if path not in seen:
                files.append(path)
                seen.add(path)
            continue
        for py_file in path.rglob("*.py"):
            if py_file not in seen:
                files.append(py_file)
                seen.add(py_file)
    return files


def main() -> int:
    violations: list[str] = []

    for py_file in _iter_py_files():
        in_services = SERVICES_DIR in py_file.parents
        root = ""
        sub = ""
        if in_services:
            root, sub = _service_subdomain(py_file)
        module = _module_path(py_file)
        for lineno, line in enumerate(py_file.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
            match = IMPORT_RE.match(line)
            if not match:
                continue

            imported = match.group(1)
            imported_root = imported.split(".", 1)[0]

            if imported_root in DEPRECATED_ROOTS:
                violations.append(
                    f"{module}:{lineno} imports deprecated root services.{imported_root}"
                )
                continue

            if in_services and root != "orchestration" and imported_root == "orchestration":
                violations.append(
                    f"{module}:{lineno} may not import services.orchestration"
                )

            if in_services and root == "web_automation" and sub == "browser":
                if imported_root in {"email", "documents", "orchestration", "enrichment"}:
                    violations.append(
                        f"{module}:{lineno} browser layer may not import services.{imported_root}"
                    )

            if in_services and root == "web_automation" and sub in {"linkedin", "google", "salesforce"}:
                if imported_root == "orchestration":
                    violations.append(
                        f"{module}:{lineno} automation domain may not import services.orchestration"
                    )

    if violations:
        print("service-boundaries: FAILED")
        for item in violations:
            print(f"  - {item}")
        return 1

    print("service-boundaries: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
