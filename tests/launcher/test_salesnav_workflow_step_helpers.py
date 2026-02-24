from scripts.salesnav_workflow_step import _extract_employee_entrypoints_from_observation


def test_extract_employee_entrypoints_from_observation_prefers_people_links_and_dedupes():
    payload = {
        "observation": {
            "dom": {
                "role_refs": [
                    {"href": "https://www.linkedin.com/sales/search/people?query=abc", "label": "View all employees", "role": "link"},
                    {"href": "https://www.linkedin.com/sales/search/people?query=abc&_ntb=1", "label": "View all employees", "role": "link"},
                ],
                "semantic_nodes": [
                    {"href": "https://www.linkedin.com/sales/lead/ACwAAAXYZ", "text": "Lead profile", "tag": "a"},
                    {"href": "https://www.linkedin.com/help", "text": "Help", "tag": "a"},
                ],
            }
        }
    }
    out = _extract_employee_entrypoints_from_observation(payload)
    assert len(out) == 2
    hrefs = {row["href"] for row in out}
    assert "https://www.linkedin.com/sales/search/people?query=abc" in hrefs
    assert "https://www.linkedin.com/sales/lead/ACwAAAXYZ" in hrefs

