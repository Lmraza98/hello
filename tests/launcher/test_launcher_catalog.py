import json
from pathlib import Path

import pytest

from launcher_runtime.catalog import CatalogError, load_catalog


def _write_catalog(tmp_path: Path, payload: dict) -> Path:
    path = tmp_path / "catalog.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_rejects_disallowed_binary(tmp_path: Path):
    payload = {
        "catalog_version": "1",
        "suites": [
            {
                "id": "s1",
                "name": "Suite",
                "description": "d",
                "tags": ["x"],
                "tests": [
                    {
                        "id": "t1",
                        "name": "bad",
                        "kind": "unit",
                        "command_template": ["bash"],
                        "args": ["-lc", "echo ok"],
                        "cwd": ".",
                    }
                ],
            }
        ],
    }
    path = _write_catalog(tmp_path, payload)
    with pytest.raises(CatalogError):
        load_catalog(path)


def test_rejects_shell_metacharacters(tmp_path: Path):
    payload = {
        "catalog_version": "1",
        "suites": [
            {
                "id": "s1",
                "name": "Suite",
                "description": "d",
                "tags": ["x"],
                "tests": [
                    {
                        "id": "t1",
                        "name": "bad",
                        "kind": "unit",
                        "command_template": ["python", "-m", "pytest"],
                        "args": ["tests;rm -rf /"],
                        "cwd": ".",
                    }
                ],
            }
        ],
    }
    path = _write_catalog(tmp_path, payload)
    with pytest.raises(CatalogError):
        load_catalog(path)


def test_dependency_reference_must_exist(tmp_path: Path):
    payload = {
        "catalog_version": "1",
        "suites": [
            {
                "id": "s1",
                "name": "Suite",
                "description": "d",
                "tags": ["x"],
                "tests": [
                    {
                        "id": "t1",
                        "name": "ok",
                        "kind": "unit",
                        "command_template": ["python", "-m", "pytest"],
                        "args": ["tests"],
                        "cwd": ".",
                        "depends_on": ["missing"],
                    }
                ],
            }
        ],
    }
    path = _write_catalog(tmp_path, payload)
    with pytest.raises(CatalogError):
        load_catalog(path)
