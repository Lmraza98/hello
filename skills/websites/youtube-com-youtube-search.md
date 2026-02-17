---
name: youtube_search
description: Searches YouTube for a given query.
domains:
  - youtube.com
entry_url: https://www.youtube.com
base_url: https://www.youtube.com
tasks:
  - youtube_search
default_extract_kind: item
extract_item_href_contains:
  - /watch?v=
extract_item_label_field: label
extract_item_url_field: ref
tags:
  - auto-learned
version: 1
---

# youtube_search

## Objective

Auto-learned skill for youtube.com. Search and extract item results.

## Action Hints

- search_input | role=combobox | text=Search

## Extraction Hints

- Result links contain `/watch?v=`.

## Repair Log

- Auto-learned from page snapshot.
