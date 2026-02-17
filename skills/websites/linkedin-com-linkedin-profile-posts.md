---
name: linkedin_profile_posts
description: Finds posts by a specific LinkedIn profile.
domains:
  - linkedin.com/
entry_url: https://www.linkedin.com/
base_url: https://www.linkedin.com
tasks:
  - linkedin_profile_posts
default_extract_kind: person
extract_person_href_contains:
  - 
extract_person_label_field: name
extract_person_url_field: url
tags:
  - auto-learned
version: 1
---

# linkedin_profile_posts

## Objective

Auto-learned skill for linkedin.com. Search and extract person results.

## Action Hints

- search_input | role=combobox | text=Search
- search_input | role=searchbox | text=Search
- search_input | role=input | text=Search
- search_input | role=textbox | text=I'm looking for

## Extraction Hints

- Result links contain ``.

## Repair Log

- Auto-learned from page snapshot.
- 2026-02-16T07:10:39.833008+00:00 | issue=search_input_failed_all_hints | attempted_hints=[{'role': 'textbox', 'text': "I'm looking for…"}], last_error=404: {'code': 'openclaw_request_failed', 'message': 'OpenClaw browser bridge request failed', 'details': {'error': 'Error: Element "e2" not found or not visible. Run a new snapshot to see current page elements.'}}, tab_id=tab-0, url=https://www.linkedin.com/feed/
- 2026-02-16T07:13:08.794960+00:00 | issue=search_input_failed_all_hints | attempted_hints=[{'role': 'combobox', 'text': 'Search'}, {'role': 'searchbox', 'text': 'Search'}, {'role': 'input', 'text': 'Search'}, {'role': 'textbox', 'text': "I'm looking for"}], last_error=404: {'code': 'openclaw_request_failed', 'message': 'OpenClaw browser bridge request failed', 'details': {'error': 'Error: Element "e2" not found or not visible. Run a new snapshot to see current page elem
- 2026-02-16T07:18:52.139628+00:00 | issue=search_input_failed_all_hints | attempted_hints=[{'role': 'combobox', 'text': 'Search'}, {'role': 'searchbox', 'text': 'Search'}, {'role': 'input', 'text': 'Search'}, {'role': 'textbox', 'text': "I'm looking for"}], last_error=404: {'code': 'openclaw_request_failed', 'message': 'OpenClaw browser bridge request failed', 'details': {'error': 'Error: Element "e2" not found or not visible. Run a new snapshot to see current page elem
- 2026-02-16T07:20:37.954915+00:00 | issue=search_input_failed_all_hints | attempted_hints=[{'role': 'combobox', 'text': 'Search'}, {'role': 'searchbox', 'text': 'Search'}, {'role': 'input', 'text': 'Search'}, {'role': 'textbox', 'text': "I'm looking for"}], last_error=404: {'code': 'openclaw_request_failed', 'message': 'OpenClaw browser bridge request failed', 'details': {'error': 'Error: Element "e2" not found or not visible. Run a new snapshot to see current page elem
