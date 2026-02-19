---
name: Weather Information
description: Extracts current weather conditions from a search query.
domains:
  - google.com/sorry/index
entry_url: https://www.google.com/sorry/index?continue=https://www.google.com/search%3Fq%3Dcurrent%2Bweather%2Bconditions%26sei%3DirKWaYWQBOj_p84Pmv3r-AU&q=EhAmAQGIwYABA9z0k6sZIVzIGIrl2swGIjD97dDm5llJCp2y54htlWlT6MIJVvB9dwJE_8CAoZXct4-ndUTl2Xyzg-7-1jkieCYyAVJaAUM
base_url: https://www.google.com
tasks:
  - extract_weather_information
default_extract_kind: item
extract_item_href_contains:
  - 
extract_item_label_field: name
extract_item_url_field: url
tags:
  - auto-learned
version: 1
---

# Weather Information

## Objective

Auto-learned skill for google.com. Search and extract item results.

## Action Hints

- search_input | role=input | text=search

## Extraction Hints

- Result links contain ``.

## Repair Log

- Auto-learned from page snapshot.
