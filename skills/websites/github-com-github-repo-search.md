---
name: github_repo_search
description: Searches GitHub repositories.
domains:
  - github.com
tasks:
  - github_repo_search
default_extract_kind: item
extract_item_href_contains:
  - /search/repositories
extract_item_label_field: name
extract_item_url_field: url
tags:
  - auto-learned
version: 1
---

# github_repo_search

## Objective

Auto-learned skill for github.com. Search and extract item results.

## Action Hints

- search_input | role=textbox | text=Search GitHub

## Extraction Hints

- Result links contain `/search/repositories`.

## Repair Log

- Auto-learned from page snapshot.
