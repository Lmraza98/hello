---
name: linkedin_posts_search
description: Searches LinkedIn posts for a given query.
domains:
  - linkedin.com/feed
entry_url: https://www.linkedin.com/feed/
base_url: https://www.linkedin.com
tasks:
  - linkedin_posts_search
default_extract_kind: person
extract_person_href_contains:
  - 
extract_person_label_field: name
extract_person_url_field: url
tags:
  - auto-learned
version: 1
---

# linkedin_posts_search

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
