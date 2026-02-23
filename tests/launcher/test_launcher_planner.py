from pathlib import Path

import pytest

from launcher_runtime import PlanError, build_run_plan, load_catalog


def test_dependency_order_is_deterministic():
    catalog = load_catalog(Path("config/launcher_test_catalog.v1.json"))
    plan = build_run_plan(catalog, test_ids=["workflow-builder-live"])
    ids = [p.test.id for p in plan]
    assert ids.index("python-builder-routes") < ids.index("workflow-builder-live")


def test_aggregate_meta_node_is_not_executed_but_expands_dependencies():
    catalog = load_catalog(Path("config/launcher_test_catalog.v1.json"))
    plan = build_run_plan(catalog, test_ids=["python-tests-all"])
    ids = [p.test.id for p in plan]
    assert "python-tests-all" not in ids
    assert "python-api-routes-browser" in ids
    assert "python-builder-routes" in ids
    assert "python-browser-core" in ids
    assert "python-launcher-core" in ids
    assert "python-platform-core" in ids
    assert "python-salesnav-core" in ids
    assert "python-workflow-core" in ids


def test_detects_cycle(tmp_path: Path):
    path = tmp_path / "catalog.json"
    path.write_text(
        """
{
  "catalog_version": "1",
  "suites": [{
    "id": "s",
    "name": "s",
    "description": "s",
    "tags": ["x"],
    "tests": [
      {"id":"a","name":"a","kind":"unit","command_template":["python"],"args":["-V"],"cwd":".","depends_on":["b"]},
      {"id":"b","name":"b","kind":"unit","command_template":["python"],"args":["-V"],"cwd":".","depends_on":["a"]}
    ]
  }]
}
""".strip(),
        encoding="utf-8",
    )
    catalog = load_catalog(path)
    with pytest.raises(PlanError):
        build_run_plan(catalog, test_ids=["a"])
