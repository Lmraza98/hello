import json
from pathlib import Path

from launcher_runtime.step_planner import StepNode, build_step_plan
import launcher


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_STEPS_PATH = ROOT / "config" / "launcher_workflow_steps.v1.json"
CASE_DEPS_PATH = ROOT / "config" / "launcher_case_deps.v1.json"


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_salesnav_workflow_steps_form_a_rooted_branching_dag():
    payload = _load_json(WORKFLOW_STEPS_PATH)
    steps = [row for row in payload.get("steps", []) if str(row.get("parent_test_id") or "") == "python-salesnav-core"]
    ids = [str(row.get("id") or "") for row in steps]
    assert ids, "expected salesnav workflow steps"

    live_flow = [
        "python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab",
        "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay",
        "python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect",
        "python-salesnav-core::workflow.salesnav.collect_companies_5.navigate_and_collect",
        "python-salesnav-core::workflow.salesnav.shared.pre_capture_observation",
        "python-salesnav-core::workflow.salesnav.collect_companies_5.capture_observation",
        "python-salesnav-core::workflow.salesnav.collect_companies_5.assert_min_count_5",
        "python-salesnav-core::workflow.salesnav.collect_companies_5.assert_required_fields",
    ]
    account_profile_flow = [
        "python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile",
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.navigate_account_profile",
        "python-salesnav-core::workflow.salesnav.shared.pre_extract_account_profile",
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.extract_account_profile",
        "python-salesnav-core::workflow.salesnav.shared.pre_capture_employee_entrypoints",
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.capture_employee_entrypoints",
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.assert_profile_required_fields",
    ]
    company_guardrail_flow = [
        "python-salesnav-core::workflow.salesnav.component_guardrails.dismiss_notifications_overlay",
        "python-salesnav-core::workflow.salesnav.component_guardrails.company_dom_extract",
        "python-salesnav-core::workflow.salesnav.component_guardrails.company_collection_contracts",
    ]
    lead_guardrail_flow = [
        "python-salesnav-core::workflow.salesnav.component_guardrails.dismiss_notifications_overlay",
        "python-salesnav-core::workflow.salesnav.component_guardrails.lead_dom_extract",
        "python-salesnav-core::workflow.salesnav.component_guardrails.session_and_filters_contracts",
    ]
    query_builder_account_root = [
        "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
    ]
    query_builder_people_flow = [
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_rejects_unmapped_values",
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id",
    ]
    sink = "python-salesnav-core::workflow.salesnav.aggregate.persist_summary"
    expected_ids = {
        *live_flow,
        *account_profile_flow,
        *company_guardrail_flow,
        *lead_guardrail_flow,
        *query_builder_account_root,
        *query_builder_people_flow,
        sink,
    }
    assert set(ids) >= expected_ids

    row_by_id = {str(row.get("id") or ""): row for row in steps}
    for chain in (live_flow, account_profile_flow, company_guardrail_flow, lead_guardrail_flow, query_builder_account_root, query_builder_people_flow):
        prev = None
        for step_id in chain:
            row = row_by_id[step_id]
            deps = [str(x) for x in row.get("deps", [])]
            if prev is None:
                if step_id == "python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab":
                    assert deps == []
                elif step_id in {
                    "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay",
                }:
                    assert deps == ["python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab"]
                elif step_id in {
                    "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
                    "python-salesnav-core::workflow.salesnav.query_builder.people_search_rejects_unmapped_values",
                }:
                    assert deps == ["python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"]
                elif step_id in {
                    "python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect",
                    "python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile",
                }:
                    assert "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay" in deps
                    assert "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts" in deps
                elif step_id == "python-salesnav-core::workflow.salesnav.component_guardrails.dismiss_notifications_overlay":
                    assert set(deps) == {
                        "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
                        "python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id",
                    }
                else:
                    assert "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay" in deps
            else:
                assert prev in deps
            prev = step_id
    assert set(row_by_id[sink].get("deps") or []) == {
        "python-salesnav-core::workflow.salesnav.collect_companies_5.assert_required_fields",
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.assert_profile_required_fields",
        "python-salesnav-core::workflow.salesnav.component_guardrails.company_collection_contracts",
        "python-salesnav-core::workflow.salesnav.component_guardrails.session_and_filters_contracts",
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id",
    }


def test_salesnav_workflow_step_dependencies_do_not_include_component_pytests():
    payload = _load_json(CASE_DEPS_PATH)
    deps_by_id = {str(row.get("id") or ""): [str(x) for x in row.get("deps", [])] for row in payload.get("steps", [])}
    workflow_ids = {node_id for node_id in deps_by_id if node_id.startswith("tests/") is False and "workflow.salesnav." in node_id}
    # Case-deps file keys are pytest nodeids, not prefixed step ids; workflow ids should not appear there.
    assert not workflow_ids


def test_selecting_salesnav_workflow_step_only_pulls_workflow_prerequisites():
    steps = {
        "python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab": StepNode(
            id="python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab",
            label="open",
            deps=[],
        ),
        "python-salesnav-core::workflow.salesnav.component_guardrails.dismiss_notifications_overlay": StepNode(
            id="python-salesnav-core::workflow.salesnav.component_guardrails.dismiss_notifications_overlay",
            label="dismiss",
            deps=[
                "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
                "python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id",
            ],
        ),
        "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay": StepNode(
            id="python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay",
            label="dismiss-shared",
            deps=["python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab"],
        ),
        "python-salesnav-core::workflow.salesnav.collect_companies_5.navigate_and_collect": StepNode(
            id="python-salesnav-core::workflow.salesnav.collect_companies_5.navigate_and_collect",
            label="collect",
            deps=["python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect"],
        ),
        "python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect": StepNode(
            id="python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect",
            label="pre-collect-guardrail",
            deps=[
                "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay",
                "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
            ],
        ),
        "python-salesnav-core::workflow.salesnav.aggregate.persist_summary": StepNode(
            id="python-salesnav-core::workflow.salesnav.aggregate.persist_summary",
            label="summary",
            deps=[
                "python-salesnav-core::workflow.salesnav.collect_companies_5.navigate_and_collect",
                "python-salesnav-core::workflow.salesnav.account_profile_e2e.assert_profile_required_fields",
                "python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id",
            ],
        ),
        "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts": StepNode(
            id="python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
            label="qb-account",
            deps=["python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"],
        ),
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_rejects_unmapped_values": StepNode(
            id="python-salesnav-core::workflow.salesnav.query_builder.people_search_rejects_unmapped_values",
            label="qb-people-rejects",
            deps=["python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"],
        ),
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id": StepNode(
            id="python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id",
            label="qb-people-uses",
            deps=["python-salesnav-core::workflow.salesnav.query_builder.people_search_rejects_unmapped_values"],
        ),
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.navigate_account_profile": StepNode(
            id="python-salesnav-core::workflow.salesnav.account_profile_e2e.navigate_account_profile",
            label="account-nav",
            deps=["python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile"],
        ),
        "python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile": StepNode(
            id="python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile",
            label="pre-account-nav-guardrail",
            deps=[
                "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay",
                "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
            ],
        ),
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.assert_profile_required_fields": StepNode(
            id="python-salesnav-core::workflow.salesnav.account_profile_e2e.assert_profile_required_fields",
            label="account-assert",
            deps=["python-salesnav-core::workflow.salesnav.account_profile_e2e.navigate_account_profile"],
        ),
        # Component/pytest-like step should never be included unless explicitly selected
        "python-salesnav-core::tests/salesnav/test_salesnav_filters.py::test_people_search_uses_url_builder_without_typing": StepNode(
            id="python-salesnav-core::tests/salesnav/test_salesnav_filters.py::test_people_search_uses_url_builder_without_typing",
            label="component",
            deps=[],
        ),
    }
    plan = build_step_plan(
        steps,
        step_ids=["python-salesnav-core::workflow.salesnav.aggregate.persist_summary"],
    )
    planned_ids = [row.step.id for row in plan]
    expected = {
        "python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab",
        "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_rejects_unmapped_values",
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id",
        "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay",
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.navigate_account_profile",
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.assert_profile_required_fields",
        "python-salesnav-core::workflow.salesnav.collect_companies_5.navigate_and_collect",
        "python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect",
        "python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile",
        "python-salesnav-core::workflow.salesnav.aggregate.persist_summary",
    }
    assert set(planned_ids) == expected
    idx = {sid: planned_ids.index(sid) for sid in planned_ids}
    assert idx["python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab"] < idx["python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"]
    assert idx["python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"] < idx["python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts"]
    assert idx["python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"] < idx["python-salesnav-core::workflow.salesnav.query_builder.people_search_rejects_unmapped_values"]
    assert idx["python-salesnav-core::workflow.salesnav.query_builder.people_search_rejects_unmapped_values"] < idx["python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id"]
    assert idx["python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab"] < idx["python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"]
    assert idx["python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"] < idx["python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect"]
    assert idx["python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts"] < idx["python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect"]
    assert idx["python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect"] < idx["python-salesnav-core::workflow.salesnav.collect_companies_5.navigate_and_collect"]
    assert idx["python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"] < idx["python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile"]
    assert idx["python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts"] < idx["python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile"]
    assert idx["python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile"] < idx["python-salesnav-core::workflow.salesnav.account_profile_e2e.navigate_account_profile"]
    assert idx["python-salesnav-core::workflow.salesnav.aggregate.persist_summary"] == len(planned_ids) - 1


def test_salesnav_component_children_are_non_sequential_in_launcher_state():
    launcher._load_catalog_state()
    rows = launcher.runtime.get("tests") or []
    salesnav = next((row for row in rows if str(row.get("id") or "") == "python-salesnav-core"), None)
    assert isinstance(salesnav, dict), "python-salesnav-core test row not found"
    children = salesnav.get("children") if isinstance(salesnav.get("children"), list) else []
    assert children, "expected children for python-salesnav-core"

    workflow_rows = [row for row in children if "workflow" in str(row.get("child_group") or "").lower()]
    component_rows = [row for row in children if "workflow" not in str(row.get("child_group") or "").lower()]
    assert workflow_rows, "expected workflow children"
    assert component_rows, "expected component children"

    row_by_id = {str(row.get("id") or ""): row for row in workflow_rows}
    assert "python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab" in row_by_id
    assert row_by_id["python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab"].get("depends_on") in ([], None)
    assert row_by_id["python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.collect_companies_5.open_or_reuse_tab"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.component_guardrails.dismiss_notifications_overlay"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id",
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay",
        "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.shared.pre_capture_observation"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.collect_companies_5.navigate_and_collect"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.collect_companies_5.navigate_and_collect"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.shared.pre_navigate_and_collect",
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.collect_companies_5.capture_observation"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.shared.pre_capture_observation"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.component_guardrails.company_dom_extract"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.component_guardrails.dismiss_notifications_overlay"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.component_guardrails.lead_dom_extract"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.component_guardrails.dismiss_notifications_overlay",
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id",
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.query_builder.people_search_rejects_unmapped_values"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_rejects_unmapped_values"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.shared.dismiss_notifications_overlay",
        "python-salesnav-core::workflow.salesnav.query_builder.account_search_contracts",
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.account_profile_e2e.navigate_account_profile"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.shared.pre_navigate_account_profile",
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.shared.pre_extract_account_profile"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.navigate_account_profile"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.account_profile_e2e.extract_account_profile"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.shared.pre_extract_account_profile"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.shared.pre_capture_employee_entrypoints"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.extract_account_profile"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.account_profile_e2e.capture_employee_entrypoints"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.shared.pre_capture_employee_entrypoints"
    ]
    assert row_by_id["python-salesnav-core::workflow.salesnav.account_profile_e2e.assert_profile_required_fields"].get("depends_on") == [
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.capture_employee_entrypoints"
    ]
    assert set(row_by_id["python-salesnav-core::workflow.salesnav.aggregate.persist_summary"].get("depends_on") or []) == {
        "python-salesnav-core::workflow.salesnav.collect_companies_5.assert_required_fields",
        "python-salesnav-core::workflow.salesnav.account_profile_e2e.assert_profile_required_fields",
        "python-salesnav-core::workflow.salesnav.component_guardrails.company_collection_contracts",
        "python-salesnav-core::workflow.salesnav.component_guardrails.session_and_filters_contracts",
        "python-salesnav-core::workflow.salesnav.query_builder.people_search_uses_sales_company_url_for_org_id",
    }
    assert all(not list(row.get("depends_on") or []) for row in component_rows), "component children should not be chained"


def test_salesnav_component_case_deps_are_not_chained():
    payload = _load_json(CASE_DEPS_PATH)
    deps_by_id = {str(row.get("id") or ""): [str(x) for x in row.get("deps", [])] for row in payload.get("steps", [])}
    salesnav_cases = [
        nodeid
        for nodeid in deps_by_id
        if nodeid.startswith("tests/salesnav/")
        or nodeid.startswith("tests/browser/test_browser_workflow_salesnav_extract.py::")
        or nodeid.startswith("tests/browser/test_browser_workflow_overlays.py::")
    ]
    assert salesnav_cases, "expected salesnav component cases in case-deps map"
    assert all(not deps_by_id[nodeid] for nodeid in salesnav_cases), "salesnav component case deps should be empty"
