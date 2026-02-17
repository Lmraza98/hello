---
name: Company Search
description: Finds companies similar to a given company.
domains:
  - google.com/search
tasks:
  - find companies similar to Chatsworth Products
default_extract_kind: company
extract_company_href_contains:
  - https://www.google.com/url?q=
extract_company_label_field: label
extract_company_url_field: ref
tags:
  - auto-learned
version: 1
---

# Company Search

## Objective

Auto-learned skill for google.com. Search and extract company results.

## Action Hints

- search_input | role=combobox | text=Search

## Extraction Hints

- Result links contain `https://www.google.com/url?q=`.

## Repair Log

- Auto-learned from page snapshot.
