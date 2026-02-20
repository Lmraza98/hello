---
name: LinkedIn Sales Navigator People Search
description: Skill for navigating Sales Navigator people search and extracting lead/profile results.
domains:
  - linkedin.com/sales/search/people
  - linkedin.com/sales/lead
entry_url: https://www.linkedin.com/sales/search/people
base_url: https://www.linkedin.com
tasks:
  - salesnav_people_search
  - salesnav_extract_leads
default_extract_kind_for_task_salesnav_people_search: lead
default_extract_kind_for_task_salesnav_extract_leads: lead
default_extract_kind: lead
tags:
  - linkedin
  - salesnav
  - people-search
extract_lead_href_contains:
  - /sales/lead/
  - /in/
extract_lead_label_field: name
extract_lead_url_field: linkedin_url
extract_lead_strip_suffixes:
  - is reachable
extract_lead_banned_exact:
  - view profile
extract_lead_banned_prefixes:
  - view profile
  - go to
  - go to 
version: 3
---

# LinkedIn Sales Navigator People Search

## Objective

Type a keyword/person name into the Sales Navigator people search bar and extract the lead cards as structured rows.

## Action Hints

- search_input | role=combobox | text=search keywords
- search_input | role=searchbox | text=search keywords
- search_input | role=input | text=search keywords
- search_input | role=input | text=search
- pagination_next | role=button | text=next
- pagination_next | role=link | text=next


## Repair Log
- 2026-02-14T23:05:58.452812+00:00 | issue=search_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/people
- 2026-02-20T05:27:02.752810+00:00 | issue=STOP_VALIDATION_FAILED | count=0, reasons=count_out_of_range,required_fields_missing,low_unique_url_fraction, task=salesnav_people_search
- 2026-02-20T20:55:59.931476+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_people_search
- 2026-02-20T20:55:59.940860+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_people_search
- 2026-02-20T20:55:59.950204+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_people_search
- 2026-02-20T21:57:33.132124+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_people_search
- 2026-02-20T21:57:33.140708+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_people_search
- 2026-02-20T21:57:33.150087+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_people_search
