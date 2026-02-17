---
name: youtube_video_views
description: Searches YouTube for videos and extracts view counts.
domains:
  - youtube.com
entry_url: https://www.youtube.com
base_url: https://www.youtube.com
tasks:
  - youtube_video_views
  - search_youtube
  - extract_views
default_extract_kind: views
default_extract_kind_for_task_youtube_video_views: views
extract_item_href_contains:
  - /watch
extract_item_label_field: title
extract_item_url_field: url
# Regex runs against `snapshot_text` (from the browser backend).
# Frontmatter parsing is not YAML; backslashes are not unescaped. Use single backslashes.
extract_views_text_regex: "\b([0-9][0-9,.]*?(?:\s*[KMB])?)\s+views\b"
extract_views_text_flags: "i"
extract_views_label_field: views
extract_views_url_field: url
tags:
  - auto-learned
version: 1
---

# youtube_video_views

## Objective

Auto-learned skill for youtube.com. Search and extract item results.

## Action Hints

- search_input | role=searchbox | text=search
- search_input | role=textbox | text=search
- search_input | role=combobox | text=search
- search_input | role=input | text=search

## Extraction Hints

- Result links contain `/watch`.

## Repair Log

- Auto-learned from page snapshot.
