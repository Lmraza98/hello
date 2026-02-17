---
name: Google Web Search
description: Search Google and extract organic result links for fact gathering.
domains:
  - google.com
  - www.google.com/search
tasks:
  - google_web_search
tags:
  - google
  - search
  - research
version: 1
default_extract_kind: result
extract_result_href_contains:
  - /url?q=
extract_result_label_field: title
extract_result_url_field: url
extract_result_banned_contains:
  - googleadservices.com
  - support.google.com
---

# Google Web Search

## Objective

Search Google and collect organic result links for citation-backed research.

## Action Hints

- search_input | role=combobox | text=Search

## Repair Log

- Seeded skill scaffold for dedicated google_search_browser workflow.

