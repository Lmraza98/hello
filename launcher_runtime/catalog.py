from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


SHELL_META_PATTERN = re.compile(r"[|;&><`$(){}\\]")
SUPPORTED_KINDS = {"unit", "integration", "live", "smoke", "custom"}
ALLOWED_BINARIES = {"python", "pytest", "npm", "node"}


class CatalogError(ValueError):
    """Raised when catalog validation fails."""


@dataclass(slots=True)
class ArtifactConfig:
    logs: bool = True
    junit: bool = True
    json: bool = True
    screenshots: bool = False


@dataclass(slots=True)
class TestCase:
    id: str
    name: str
    kind: str
    command_template: list[str]
    args: list[str] = field(default_factory=list)
    cwd: str = "."
    env_allowlist: list[str] = field(default_factory=list)
    timeout_sec: int = 300
    retries: int = 0
    depends_on: list[str] = field(default_factory=list)
    artifacts: ArtifactConfig = field(default_factory=ArtifactConfig)
    enabled: bool = True
    tags: list[str] = field(default_factory=list)


@dataclass(slots=True)
class TestSuite:
    id: str
    name: str
    description: str
    tags: list[str]
    tests: list[TestCase]


@dataclass(slots=True)
class TestCatalog:
    catalog_version: str
    suites: list[TestSuite]

    def tests_by_id(self) -> dict[str, TestCase]:
        out: dict[str, TestCase] = {}
        for suite in self.suites:
            for test in suite.tests:
                if test.id in out:
                    raise CatalogError(f"duplicate test id: {test.id}")
                out[test.id] = test
        return out


def _require_str(value: Any, key: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise CatalogError(f"{key} must be a non-empty string")
    return value.strip()


def _list_of_str(value: Any, key: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise CatalogError(f"{key} must be a list of strings")
    out: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise CatalogError(f"{key} must be a list of strings")
        token = item.strip()
        if token:
            out.append(token)
    return out


def _validate_token(token: str, key: str) -> None:
    if SHELL_META_PATTERN.search(token):
        raise CatalogError(f"{key} contains forbidden shell metacharacters: {token!r}")


def _parse_artifacts(raw: Any) -> ArtifactConfig:
    if raw is None:
        return ArtifactConfig()
    if not isinstance(raw, dict):
        raise CatalogError("artifacts must be an object")
    return ArtifactConfig(
        logs=bool(raw.get("logs", True)),
        junit=bool(raw.get("junit", True)),
        json=bool(raw.get("json", True)),
        screenshots=bool(raw.get("screenshots", False)),
    )


def _parse_test(raw: dict[str, Any], suite_tags: list[str]) -> TestCase:
    test_id = _require_str(raw.get("id"), "tests[].id")
    name = _require_str(raw.get("name"), f"tests[{test_id}].name")
    kind = _require_str(raw.get("kind"), f"tests[{test_id}].kind")
    if kind not in SUPPORTED_KINDS:
        raise CatalogError(f"tests[{test_id}].kind unsupported: {kind}")

    command_template = _list_of_str(raw.get("command_template"), f"tests[{test_id}].command_template")
    if not command_template:
        raise CatalogError(f"tests[{test_id}] command_template cannot be empty")
    for token in command_template:
        _validate_token(token, f"tests[{test_id}].command_template")

    binary = Path(command_template[0]).name.lower()
    if binary not in ALLOWED_BINARIES:
        raise CatalogError(f"tests[{test_id}] uses disallowed binary: {command_template[0]}")

    args = _list_of_str(raw.get("args"), f"tests[{test_id}].args")
    for token in args:
        _validate_token(token, f"tests[{test_id}].args")

    cwd = _require_str(raw.get("cwd", "."), f"tests[{test_id}].cwd")
    env_allowlist = _list_of_str(raw.get("env_allowlist"), f"tests[{test_id}].env_allowlist")
    depends_on = _list_of_str(raw.get("depends_on"), f"tests[{test_id}].depends_on")
    tags = _list_of_str(raw.get("tags"), f"tests[{test_id}].tags")

    timeout_sec = int(raw.get("timeout_sec", 300))
    retries = int(raw.get("retries", 0))
    if timeout_sec <= 0:
        raise CatalogError(f"tests[{test_id}].timeout_sec must be > 0")
    if retries < 0 or retries > 5:
        raise CatalogError(f"tests[{test_id}].retries must be between 0 and 5")

    return TestCase(
        id=test_id,
        name=name,
        kind=kind,
        command_template=command_template,
        args=args,
        cwd=cwd,
        env_allowlist=env_allowlist,
        timeout_sec=timeout_sec,
        retries=retries,
        depends_on=depends_on,
        artifacts=_parse_artifacts(raw.get("artifacts")),
        enabled=bool(raw.get("enabled", True)),
        tags=sorted(set(suite_tags + tags)),
    )


def _validate_dependencies(catalog: TestCatalog) -> None:
    tests = catalog.tests_by_id()
    for test in tests.values():
        for dep in test.depends_on:
            if dep not in tests:
                raise CatalogError(f"tests[{test.id}] depends_on unknown id: {dep}")


def load_catalog(path: Path) -> TestCatalog:
    if not path.exists():
        raise CatalogError(f"catalog file not found: {path}")

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise CatalogError(f"invalid catalog JSON: {exc}") from exc

    if not isinstance(raw, dict):
        raise CatalogError("catalog root must be an object")
    version = _require_str(raw.get("catalog_version"), "catalog_version")
    if version != "1":
        raise CatalogError(f"unsupported catalog_version: {version}")

    raw_suites = raw.get("suites")
    if not isinstance(raw_suites, list) or not raw_suites:
        raise CatalogError("suites must be a non-empty list")

    suites: list[TestSuite] = []
    suite_ids: set[str] = set()

    for raw_suite in raw_suites:
        if not isinstance(raw_suite, dict):
            raise CatalogError("suite entry must be an object")
        suite_id = _require_str(raw_suite.get("id"), "suites[].id")
        if suite_id in suite_ids:
            raise CatalogError(f"duplicate suite id: {suite_id}")
        suite_ids.add(suite_id)

        suite_name = _require_str(raw_suite.get("name"), f"suites[{suite_id}].name")
        description = _require_str(raw_suite.get("description", "No description"), f"suites[{suite_id}].description")
        suite_tags = _list_of_str(raw_suite.get("tags"), f"suites[{suite_id}].tags")

        raw_tests = raw_suite.get("tests")
        if not isinstance(raw_tests, list) or not raw_tests:
            raise CatalogError(f"suites[{suite_id}].tests must be a non-empty list")
        tests = [_parse_test(t, suite_tags) for t in raw_tests if isinstance(t, dict)]
        if len(tests) != len(raw_tests):
            raise CatalogError(f"suites[{suite_id}].tests contains invalid entries")

        suites.append(
            TestSuite(
                id=suite_id,
                name=suite_name,
                description=description,
                tags=suite_tags,
                tests=tests,
            )
        )

    catalog = TestCatalog(catalog_version=version, suites=suites)
    _validate_dependencies(catalog)
    return catalog
