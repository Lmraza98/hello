---
name: LinkedIn Sales Navigator Accounts
description: Reusable browser skill for searching, filtering, and extracting Sales Navigator account results.
domains:
  - linkedin.com/sales/search/company
  - linkedin.com/sales/company
entry_url: https://www.linkedin.com/sales/search/company
base_url: https://www.linkedin.com
tasks:
  - salesnav_search_account
  - salesnav_extract_companies
  - salesnav_list_employees
  - salesnav_extract_leads
default_extract_kind_for_task_salesnav_search_account: company
default_extract_kind_for_task_salesnav_extract_companies: company
default_extract_kind_for_task_salesnav_list_employees: lead
default_extract_kind_for_task_salesnav_extract_leads: lead
default_extract_kind: company
tags:
  - linkedin
  - salesnav
  - account-search
filter_headquarters_location_expand_action: headquarters_location_filter
filter_headquarters_location_input_action: headquarters_location_input
filter_headquarters_location_submit: true
filter_headquarters_location_select_option: false
filter_headquarters_location_confirm_action: headquarters_location_include_button
filter_headquarters_location_verify: false
filter_industry_expand_action: industry_filter
filter_industry_input_action: industry_input
filter_industry_submit: false
filter_industry_select_option: true
filter_industry_confirm_action: industry_include_button
filter_industry_verify: false
filter_company_headcount_expand_action: company_headcount_filter
filter_company_headcount_select_option: true
filter_company_headcount_verify: true
filter_annual_revenue_expand_action: annual_revenue_filter
filter_annual_revenue_select_option: true
filter_annual_revenue_option_role: button
filter_annual_revenue_verify: false
filter_company_headcount_growth_expand_action: company_headcount_growth_filter
filter_company_headcount_growth_select_option: true
filter_company_headcount_growth_option_role: button
filter_company_headcount_growth_verify: false
filter_fortune_expand_action: fortune_filter
filter_fortune_select_option: true
filter_fortune_option_role: button
filter_fortune_verify: false
filter_number_of_followers_expand_action: number_of_followers_filter
filter_number_of_followers_select_option: true
filter_number_of_followers_option_role: button
filter_number_of_followers_verify: false
filter_department_headcount_expand_action: department_headcount_filter
filter_department_headcount_select_option: true
filter_department_headcount_option_role: button
filter_department_headcount_verify: false
filter_department_headcount_growth_expand_action: department_headcount_growth_filter
filter_department_headcount_growth_select_option: true
filter_department_headcount_growth_option_role: button
filter_department_headcount_growth_verify: false
filter_job_opportunities_expand_action: job_opportunities_filter
filter_job_opportunities_select_option: true
filter_job_opportunities_option_role: button
filter_job_opportunities_verify: false
filter_recent_activities_expand_action: recent_activities_filter
filter_recent_activities_select_option: true
filter_recent_activities_option_role: button
filter_recent_activities_verify: false
filter_connection_expand_action: connection_filter
filter_connection_select_option: true
filter_connection_option_role: button
filter_connection_verify: false
filter_companies_in_crm_expand_action: companies_in_crm_filter
filter_companies_in_crm_select_option: true
filter_companies_in_crm_option_role: button
filter_companies_in_crm_verify: false
filter_saved_accounts_expand_action: saved_accounts_filter
filter_saved_accounts_select_option: true
filter_saved_accounts_option_role: button
filter_saved_accounts_verify: false
filter_account_lists_expand_action: account_lists_filter
filter_account_lists_select_option: true
filter_account_lists_option_role: button
filter_account_lists_verify: false
extract_company_href_contains:
  - /sales/company/
extract_company_label_field: name
extract_company_url_field: sales_nav_url
extract_company_banned_prefixes:
  - view all
  - save search
extract_company_banned_contains:
  - strategic priorities
extract_lead_href_contains:
  - /sales/lead/
  - /in/
extract_lead_label_field: name
extract_lead_url_field: linkedin_url
extract_lead_strip_suffixes:
  - is reachable
extract_lead_banned_prefixes:
  - view
extract_lead_banned_contains:
  - unlock their profile
extract_lead_min_label_len: 2
extract_lead_banned_exact:
  - view profile
extract_lead_banned_prefixes:
  - view profile
version: 2
---

# LinkedIn Sales Navigator Accounts

## Objective

Navigate account search, apply filters, and extract company rows reliably.

## Entry Points

- Accounts home list page (account lists UI)
- Accounts search page (filters sidebar + results pane)

## Action Hints

### Canonical actions (used by workflows)

- search_input | role=combobox | text=search keywords
- search_input | role=searchbox | text=search keywords
- search_input | role=input | text=search keywords
- search_input | role=input | text=search
- headquarters_location_filter | role=button | text=headquarters location
- headquarters_location_input | role=input | text=add locations
- headquarters_location_input | role=combobox | text=add locations
- headquarters_location_input | role=input | text=unit
- headquarters_location_input | role=combobox | text=unit
- headquarters_location_input | role=input | text=location
- headquarters_location_input | role=combobox | text=location
- employee_entrypoint | role=link | text=all employees
- employee_entrypoint | role=link | text=decision makers
- employee_entrypoint | role=button | text=view current employees
- employee_entrypoint | role=link | text=view all employees

- entrypoint | role=link | text=all employees
- entrypoint | role=link | text=decision makers
- entrypoint | role=button | text=view current employees
- entrypoint | role=link | text=view all employees
- pagination_next | role=button | text=next
- pagination_next | role=link | text=next

### Global navigation and list view (accounts home)

- global_search_input | role=input | text=search
- lead_filters_button | role=button | text=lead filters
- account_filters_button | role=button | text=account filters
- saved_searches_link | role=link | text=saved searches
- personas_link | role=link | text=personas

- account_list_dropdown | role=button | text=account list
- account_list_name_chip | role=button | text=like
- view_in_search_button | role=button | text=view in search
- see_account_lists_link | role=link | text=see account lists

- filter_companies_all_tab | role=button | text=all
- filter_companies_starred_tab | role=button | text=starred
- filter_companies_growth_alerts_tab | role=button | text=growth alerts
- filter_companies_risk_alerts_tab | role=button | text=risk alerts
- columns_button | role=button | text=columns
- persona_dropdown | role=button | text=cxo

### Account search page (filters sidebar)

- search_keywords_input | role=input | text=search keywords
- search_keywords_input | role=input | text=keywords
- search_keywords_input | role=combobox | text=search keywords
- search_keywords_input | role=textbox | text=search keywords
- collapse_filters_button | role=button | text=collapse
- clear_all_filters_button | role=button | text=clear all
- pin_filters_button | role=button | text=pin filters
- advanced_filter_definitions_link | role=link | text=advanced filter definitions

#### Company attributes

- annual_revenue_filter | role=button | text=annual revenue
- company_headcount_filter | role=button | text=company headcount
- company_headcount_growth_filter | role=button | text=company headcount growth
- headquarters_location_filter | role=button | text=headquarters location
- industry_filter | role=button | text=industry
- number_of_followers_filter | role=button | text=number of followers
- department_headcount_filter | role=button | text=department headcount
- department_headcount_growth_filter | role=button | text=department headcount growth
- fortune_filter | role=button | text=fortune

#### Spotlights and workflow (often optional)

- job_opportunities_filter | role=button | text=job opportunities
- recent_activities_filter | role=button | text=recent activities
- connection_filter | role=button | text=connection

- companies_in_crm_filter | role=button | text=companies in crm
- saved_accounts_filter | role=button | text=saved accounts
- account_lists_filter | role=button | text=account lists

### Filter widgets (opened state)

#### Annual revenue

- annual_revenue_currency_dropdown | role=button | text=usd
- annual_revenue_min_dropdown | role=button | text=min (millions)
- annual_revenue_max_dropdown | role=button | text=max (millions)
- annual_revenue_reset_button | role=button | text=reset
- annual_revenue_add_button | role=button | text=add

#### Company headcount

- company_headcount_option_1_10 | role=button | text=1-10
- company_headcount_option_11_50 | role=button | text=11-50
- company_headcount_option_51_200 | role=button | text=51-200
- company_headcount_option_201_500 | role=button | text=201-500
- company_headcount_option_501_1000 | role=button | text=501-1,000
- company_headcount_option_1001_5000 | role=button | text=1,001-5,000

#### Company headcount growth

- company_headcount_growth_min_input | role=input | text=min (%)
- company_headcount_growth_max_input | role=input | text=max (%)
- company_headcount_growth_reset_button | role=button | text=reset
- company_headcount_growth_add_button | role=button | text=add

#### Headquarters location

- headquarters_location_input | role=input | text=add locations
- headquarters_location_input | role=input | text=unit
- headquarters_location_input | role=input | text=location
- headquarters_location_region_radio | role=radio | text=region
- headquarters_location_postal_code_radio | role=radio | text=postal code
- headquarters_location_include_button | role=button | text=include
- headquarters_location_exclude_button | role=button | text=exclude

#### Industry

- industry_input | role=input | text=industry
- industry_include_button | role=button | text=include
- industry_exclude_button | role=button | text=exclude

#### Number of followers

- followers_option_1_50 | role=button | text=1-50
- followers_option_51_100 | role=button | text=51-100
- followers_option_101_1000 | role=button | text=101-1000
- followers_option_1001_5000 | role=button | text=1001-5000
- followers_option_5001_plus | role=button | text=5001+

### Results actions (top of results pane)

- select_all_checkbox | role=checkbox | text=select all
- save_to_list_button | role=button | text=save to list
- unsave_button | role=button | text=unsave
- view_current_employees_button | role=button | text=view current employees

## Search Workflow

1. From Accounts home, click **Account filters** to open the account search page.
2. Apply relevant Company attributes filters (HQ location, industry, revenue, headcount, etc.).
3. Ensure results render in the right pane (the empty-state illustration disappears).
4. Extract company rows from the results list.

## Extraction Hints

- Company profile links contain `/sales/company/`.
- Prefer extracting from visible result rows in the results list (right pane), not from lead recommendations cards or empty-state UI.
- On accounts home (account list view), company rows appear as a table-like list with:
  - checkbox at far left
  - company logo + company name link
  - optional subtext under name (industry/category)
  - connection paths count
  - alerts column
  - notes action ("Add note")
- Ignore non-company pseudo-rows and UI widgets (chat bubble, banners, empty-state illustration).
- Keep the result list deduplicated by `(normalized_name, sales_nav_url_path)` where `sales_nav_url_path` is the pathname part of the company link.
- If the company name is truncated visually (ellipsis), prefer `aria-label` or full link text when available; otherwise keep the displayed text.

### Suggested extracted fields (minimum viable)

- name
- sales_nav_url
- subtitle (industry/category line under the name, if present)
- connection_paths_count (if present)
- alerts_summary (if present)

## Repair Log

- Seeded baseline skill.

- 2026-02-14T05:05:39.100292+00:00 | issue=headquarters_location_input_not_found | headquarters_location=United States, query=fintech companies in united states, task=salesnav_search_account, url=https://www.linkedin.com/sales/search/company
- 2026-02-14T05:08:00.489498+00:00 | issue=headquarters_location_input_not_found | headquarters_location=United States, query=healthcare, task=salesnav_search_account, url=https://www.linkedin.com/sales/search/company

### Repair notes for headquarters_location_input_not_found

- The HQ location input may show placeholder/value text like "Unit" and can appear inside an expanded filter panel, not as a standalone "Add locations" control.
- Fallback strategy:
  1. Click `headquarters_location_filter`
  2. Look for a text input within the expanded panel whose placeholder/value contains `Unit` OR an input near `Region` / `Postal code` radios
  3. Type the location, then click `Include` for the matching row (example: "United States")
- 2026-02-14T06:35:27.228037+00:00 | issue=headquarters_location_input_not_found | headquarters_location=California, United States, query=fintech companies in united states, task=salesnav_search_account, url=https://www.linkedin.com/sales/search/company
- 2026-02-14T07:20:33.250623+00:00 | issue=headquarters_location_input_not_found | headquarters_location=United States, query=healthcare companies in united states, task=salesnav_search_account, url=https://www.linkedin.com/sales/search/company
- 2026-02-14T08:05:40.101279+00:00 | issue=headquarters_location_input_not_found | headquarters_location=California, United States, query=fintech companies in united states, task=salesnav_search_account, url=https://www.linkedin.com/sales/search/company
- 2026-02-14T08:50:24.169444+00:00 | issue=headquarters_location_filter_not_found | query=healthcare companies in united states, task=salesnav_search_account, url=https://www.linkedin.com/sales/search/company
- 2026-02-14T08:50:42.966170+00:00 | issue=headquarters_location_input_not_found | headquarters_location=United States, query=healthcare companies in united states, task=salesnav_search_account, url=https://www.linkedin.com/sales/search/company
- 2026-02-14T09:31:52.112845+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3Ahealthcare)&sessionId=7iO8dOLuRSymPWNkT3F8bg%3D%3D
- 2026-02-14T09:41:14.465355+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3Ahealthcare)&sessionId=PWm%2BZFXPRt66WQ3u3A8x5Q%3D%3D
- 2026-02-14T10:21:19.607219+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3Ahealthcare%2520companies%2520in%2520united%2520states)&sessionId=hJ0yPGYiQkmVEA5fmjbpvw%3D%3D
- 2026-02-14T12:36:33.873271+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3Afintech%2520companies%2520in%2520united%2520states)&sessionId=rTM5JwNoQ0yWaXBRtkw0QQ%3D%3D
- 2026-02-14T13:21:17.650774+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Cfilters%3AList((type%3AREGION%2Cvalues%3AList((id%3A103644278%2Ctext%3AUnited%2520States%2CselectionType%3AINCLUDED))))%2Ckeywords%3Ahealthcare%2520companies%2520in%2520united%2520states)&sessionId=EvOJ2WDQQqKSIxUVOj0oeA%3D%3D
- 2026-02-14T14:06:17.426311+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Cfilters%3AList((type%3AREGION%2Cvalues%3AList((id%3A103644278%2Ctext%3AUnited%2520States%2CselectionType%3AINCLUDED))))%2Ckeywords%3Afintech%2520companies%2520in%2520united%2520states)&sessionId=vQzeNtgcS6apk8CD5mFZhw%3D%3D
- 2026-02-14T14:51:17.235957+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3Ahealthcare%2520companies%2520in%2520united%2520states)&sessionId=n2RhKWn%2FQ3ehpEvZp2D5eg%3D%3D
- 2026-02-14T15:36:20.318929+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3Afintech%2520companies%2520in%2520united%2520states)&sessionId=ICvZpy2cQGKVlVBZ6uo58w%3D%3D
- 2026-02-14T16:21:17.925944+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3Ahealthcare%2520companies%2520in%2520united%2520states)&sessionId=gDb5OGg5SG%2ByX3HSdqXV0A%3D%3D
- 2026-02-14T17:06:20.183568+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3Afintech%2520companies%2520in%2520united%2520states)&sessionId=fHJXLdU4T0inO5ZCMDJ5Ww%3D%3D
- 2026-02-14T17:51:18.748589+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3Ahealthcare%2520companies%2520in%2520united%2520states)&sessionId=S4l4Cn1MS42CA6ZhTpULaQ%3D%3D
- 2026-02-14T21:05:04.063391+00:00 | issue=headquarters_location_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3Ahealthcare)&sessionId=jiE58k%2FLSy%2Bola6YydT9kQ%3D%3D
- 2026-02-14T22:00:15.578130+00:00 | issue=employee_entrypoint_not_found | tab_id=tab-0, url=about:blank
- 2026-02-14T22:02:13.828550+00:00 | issue=pagination_next_not_found | tab_id=tab-1, url=about:blank
- 2026-02-14T23:16:37.390761+00:00 | issue=search_input_not_found | tab_id=tab-0, url=https://www.linkedin.com/sales/search/company
- 2026-02-16T09:47:49.098615+00:00 | issue=search_keywords_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'search keywords'}, {'role': 'input', 'text': 'keywords'}, {'role': 'combobox', 'text': 'search keywords'}, {'role': 'textbox', 'text': 'search keywords'}], last_error=500: {'code': 'openclaw_request_failed', 'message': 'OpenClaw browser bridge request failed', 'details': {'error': 'Error: locator.type: Target page, context or browser has been closed\nCal
- 2026-02-16T09:48:08.703535+00:00 | issue=search_input_failed_all_hints | attempted_hints=[{'role': 'combobox', 'text': 'search keywords'}, {'role': 'searchbox', 'text': 'search keywords'}, {'role': 'input', 'text': 'search keywords'}, {'role': 'input', 'text': 'search'}], last_error=, tab_id=tab-0, url=about:blank
- 2026-02-16T10:26:17.076135+00:00 | issue=job_opportunities_filter_failed_all_hints | attempted_hints=[{'role': 'button', 'text': 'job opportunities'}], last_error=, tab_id=tab-0, url=about:blank
- 2026-02-16T14:54:42.375364+00:00 | issue=industry_include_button_failed_all_hints | attempted_hints=[{'role': 'button', 'text': 'include'}], last_error=, tab_id=tab-0, url=about:blank
- 2026-02-16T14:54:45.836668+00:00 | issue=industry_filter_failed_all_hints | attempted_hints=[{'role': 'button', 'text': 'industry'}], last_error=, tab_id=tab-0, url=about:blank
- 2026-02-16T23:47:34.464593+00:00 | issue=industry_include_button_failed_all_hints | attempted_hints=[{'role': 'button', 'text': 'include'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3ASaaS%2520AI-powered%2520cybersecurity)&sessionId=KTtVeTzOQG2zpuFIE6AW1w%3D%3D
- 2026-02-16T23:47:37.852215+00:00 | issue=industry_filter_failed_all_hints | attempted_hints=[{'role': 'button', 'text': 'industry'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Ckeywords%3ASaaS%2520AI-powered%2520cybersecurity)&sessionId=KTtVeTzOQG2zpuFIE6AW1w%3D%3D
- 2026-02-17T01:03:29.419582+00:00 | issue=search_keywords_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'search keywords'}, {'role': 'input', 'text': 'keywords'}, {'role': 'combobox', 'text': 'search keywords'}, {'role': 'textbox', 'text': 'search keywords'}], last_error=502: {'code': 'act_failed', 'message': "name 're' is not defined"}, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company
- 2026-02-17T01:03:30.937354+00:00 | issue=search_input_failed_all_hints | attempted_hints=[{'role': 'combobox', 'text': 'search keywords'}, {'role': 'searchbox', 'text': 'search keywords'}, {'role': 'input', 'text': 'search keywords'}, {'role': 'input', 'text': 'search'}], last_error=502: {'code': 'act_failed', 'message': "name 're' is not defined"}, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company
- 2026-02-17T01:07:16.221719+00:00 | issue=industry_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'industry'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?viewAllFilters=true
- 2026-02-17T01:48:37.588624+00:00 | issue=industry_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'industry'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?viewAllFilters=true
- 2026-02-17T01:49:53.633953+00:00 | issue=industry_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'industry'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?viewAllFilters=true
- 2026-02-17T05:18:20.769758+00:00 | issue=headquarters_location_include_button_failed_all_hints | attempted_hints=[{'role': 'button', 'text': 'include'}], last_error=502: {'code': 'act_failed', 'message': 'Locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator("a,button,input,textarea,select,[role=\'button\'],[role=\'link\'],[role=\'textbox\'],[role=\'searchbox\'],[role=\'combobox\'],[contenteditable=\'true\'],[tabindex]").nth(24)\n  -     - locator resolved to <button id
- 2026-02-17T05:25:39.420663+00:00 | issue=industry_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'industry'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Cfilters%3AList((type%3AREGION%2Cvalues%3AList((id%3A103644278%2Ctext%3AUnited%2520States%2CselectionType%3AINCLUDED)))))&sessionId=Gyu7RfeGTniQxkWJ%2BR5osA%3D%3D
- 2026-02-17T05:25:44.346061+00:00 | issue=industry_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'industry'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?query=(spellCorrectionEnabled%3Atrue%2Cfilters%3AList((type%3AREGION%2Cvalues%3AList((id%3A103644278%2Ctext%3AUnited%2520States%2CselectionType%3AINCLUDED)))))&sessionId=Gyu7RfeGTniQxkWJ%2BR5osA%3D%3D&viewAllFilters=true
- 2026-02-17T05:35:51.376745+00:00 | issue=industry_filter_failed_all_hints | attempted_hints=[{'role': 'button', 'text': 'industry'}], last_error=502: {'code': 'act_failed', 'message': 'Locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator("a,button,input,textarea,select,[role=\'button\'],[role=\'link\'],[role=\'textbox\'],[role=\'searchbox\'],[role=\'combobox\'],[contenteditable=\'true\'],[tabindex]").nth(34)\n  -     - locator resolved to <button t
- 2026-02-17T05:35:56.154965+00:00 | issue=industry_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'industry'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?viewAllFilters=true
- 2026-02-17T05:36:56.264126+00:00 | issue=search_keywords_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'search keywords'}, {'role': 'input', 'text': 'keywords'}, {'role': 'combobox', 'text': 'search keywords'}, {'role': 'textbox', 'text': 'search keywords'}], last_error=502: {'code': 'act_failed', 'message': 'Locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator("a,button,input,textarea,select,[role=\'button\'],[role=\'link\'],[role=
- 2026-02-17T05:38:55.185372+00:00 | issue=search_keywords_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'search keywords'}, {'role': 'input', 'text': 'keywords'}, {'role': 'combobox', 'text': 'search keywords'}, {'role': 'textbox', 'text': 'search keywords'}], last_error=502: {'code': 'act_failed', 'message': 'Locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator("a,button,input,textarea,select,[role=\'button\'],[role=\'link\'],[role=
- 2026-02-17T05:39:56.757041+00:00 | issue=search_input_failed_all_hints | attempted_hints=[{'role': 'combobox', 'text': 'search keywords'}, {'role': 'searchbox', 'text': 'search keywords'}, {'role': 'input', 'text': 'search keywords'}, {'role': 'input', 'text': 'search'}], last_error=502: {'code': 'act_failed', 'message': 'Locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator("a,button,input,textarea,select,[role=\'button\'],[role=\'link\'],[role=
- 2026-02-17T05:43:04.468294+00:00 | issue=industry_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'industry'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?viewAllFilters=true
- 2026-02-17T05:48:05.027924+00:00 | issue=industry_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'industry'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?viewAllFilters=true
- 2026-02-17T05:53:05.408461+00:00 | issue=industry_input_failed_all_hints | attempted_hints=[{'role': 'input', 'text': 'industry'}], last_error=, tab_id=tab-0, url=https://www.linkedin.com/sales/search/company?viewAllFilters=true
- 2026-02-17T06:01:20.940585+00:00 | issue=fortune_filter_failed_all_hints | attempted_hints=[{'role': 'button', 'text': 'fortune'}], last_error=502: {'code': 'act_failed', 'message': 'Locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator("a,button,input,textarea,select,[role=\'button\'],[role=\'link\'],[role=\'textbox\'],[role=\'searchbox\'],[role=\'combobox\'],[contenteditable=\'true\'],[tabindex]").nth(32)\n  -     - locator resolved to <button ty
- 2026-02-17T06:04:00.349070+00:00 | issue=companies_in_crm_filter_failed_all_hints | attempted_hints=[{'role': 'button', 'text': 'companies in crm'}], last_error=502: {'code': 'act_failed', 'message': 'Locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator("a,button,input,textarea,select,[role=\'button\'],[role=\'link\'],[role=\'textbox\'],[role=\'searchbox\'],[role=\'combobox\'],[contenteditable=\'true\'],[tabindex]").nth(69)\n  -     - locator resolved to <
- 2026-02-17T06:05:09.119861+00:00 | issue=account_lists_filter_failed_all_hints | attempted_hints=[{'role': 'button', 'text': 'account lists'}], last_error=502: {'code': 'act_failed', 'message': 'Locator.click: Timeout 15000ms exceeded.\nCall log:\n  - waiting for locator("a,button,input,textarea,select,[role=\'button\'],[role=\'link\'],[role=\'textbox\'],[role=\'searchbox\'],[role=\'combobox\'],[contenteditable=\'true\'],[tabindex]").nth(71)\n  -     - locator resolved to <but
- 2026-02-20T20:55:59.879978+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-20T20:55:59.913819+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-20T20:55:59.922965+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-20T21:57:33.099538+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-20T21:57:33.113045+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-20T21:57:33.122810+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T21:01:37.053698+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T21:02:02.908501+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T21:02:06.005317+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T21:08:18.929477+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:21:21.386883+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:21:29.840399+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:21:31.002356+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:34:34.708784+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:34:37.133410+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:34:38.392813+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:37:09.599030+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:37:12.566326+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:37:13.787072+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:39:52.637395+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:39:55.017091+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:39:56.226904+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:43:52.711043+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:43:55.018759+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:43:56.220935+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:46:22.549759+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:46:24.867675+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:46:26.057394+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:51:03.553713+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:51:05.877642+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T22:51:07.102260+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:02:44.926978+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:02:47.265140+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:02:48.432177+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:09:45.911954+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:09:48.324326+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:09:49.508594+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:16:13.366572+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:16:15.788910+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:16:16.982309+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:28:38.277100+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:28:40.708042+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:28:41.965156+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:34:39.380504+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:34:41.932160+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:34:43.212218+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:36:07.199488+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:36:08.398933+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:36:09.561815+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:37:32.734510+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:37:33.905269+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:37:35.092806+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:38:53.828597+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:38:55.311510+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:38:56.859441+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:41:04.435193+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:41:06.742764+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:41:07.938769+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:42:53.163581+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:42:54.412065+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:42:55.629761+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:45:50.147461+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:45:52.524965+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:45:53.753040+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:47:15.847138+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:47:17.078884+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:47:18.287559+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:48:40.806487+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:48:42.040579+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:48:43.276875+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:51:23.553668+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:51:26.055684+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:51:26.745644+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:52:50.392942+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:52:51.617744+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-21T23:52:52.854295+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:01:17.957063+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:01:21.035288+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:01:23.305031+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:02:52.216639+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:02:54.445272+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:02:56.655612+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:05:45.602866+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:05:48.766580+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:05:51.882381+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:15:08.973294+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:15:12.527380+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T00:15:16.238560+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:08:38.257494+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:08:41.649916+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:08:44.813663+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:12:15.707156+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:30:58.170712+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:31:01.555884+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:31:04.981382+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:41:02.853044+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:41:06.511681+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:41:10.150559+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:53:05.356416+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:53:08.961079+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T01:53:12.628828+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:01:24.211851+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:01:27.837525+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:01:31.469190+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:11:41.937479+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:11:44.296329+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:11:44.320997+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:14:49.385446+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:14:51.775790+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:14:51.799552+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:17:33.705729+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:17:45.298972+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:17:45.322377+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:37:52.421641+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:37:55.025378+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:37:55.050382+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:43:16.164922+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:43:18.310357+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T02:43:18.331332+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:01:23.570594+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:01:42.431145+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:01:42.454436+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:14:20.225361+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:14:22.514558+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:14:22.534001+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:19:30.915468+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:23:04.140671+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:23:06.253697+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:23:06.278409+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:27:24.221160+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:27:26.700495+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:27:26.728958+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:31:43.499699+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:31:45.614990+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:31:45.637285+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:41:54.120673+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:41:57.462783+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:42:00.698651+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:45:54.244345+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:45:57.476814+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:46:00.698684+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:49:30.407495+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:49:33.757680+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:49:37.039126+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:52:51.560825+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:52:54.854116+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:52:58.163230+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:55:00.280821+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:55:03.412669+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T03:55:12.444306+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:06:12.651457+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:06:16.199184+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:06:19.328189+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:10:31.181280+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:10:34.547803+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:16:15.550628+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:16:18.784029+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:16:21.884398+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:19:49.403879+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:19:52.557391+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:19:55.855011+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:22:29.950960+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:22:33.364763+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:22:36.735608+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:24:31.607434+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:24:35.089120+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:24:38.454599+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:27:59.942054+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:28:03.191456+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:28:06.366008+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:32:57.657008+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:33:00.923894+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:33:04.276606+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:40:24.505068+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:40:27.553077+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:40:30.682828+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:48:22.257802+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:48:25.641187+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T04:48:29.684349+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:00:09.733289+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:00:12.932016+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:00:16.108788+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:23:45.548486+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:23:48.999529+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:23:52.231668+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:30:50.479068+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:30:53.711727+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:30:56.999551+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:38:51.208728+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:38:54.341932+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:38:57.441237+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:46:14.486457+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:46:17.732176+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:48:04.271298+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:59:42.206701+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:59:45.369460+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T05:59:48.374827+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T06:02:43.291276+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T06:02:46.422494+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T06:02:49.457340+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:01:01.777356+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:01:05.007484+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:01:08.361812+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:19:32.549290+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:19:35.715295+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:19:38.891492+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:24:45.489092+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:29:43.983140+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:29:47.327808+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:34:25.155540+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:34:28.440681+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:34:31.559845+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:40:30.044460+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:40:33.300928+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:40:36.631483+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:45:23.325893+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:46:47.609492+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:46:50.806957+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:49:41.638587+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:49:45.041173+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T07:49:48.425997+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:12:23.800837+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:18:29.486609+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:18:37.948792+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:18:46.830340+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:37:59.974347+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:41:55.433987+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:42:03.666000+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:42:11.896913+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:47:12.568259+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:47:20.778205+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:47:28.928313+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:56:08.967470+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:56:17.280265+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T08:56:25.456013+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:05:41.544780+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:11:09.230813+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:11:17.616167+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:11:25.825982+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:19:14.433195+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:23:58.757992+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:24:02.010055+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:24:05.228234+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:49:53.049641+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:49:56.189866+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T09:49:59.304870+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:32:50.738488+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:32:53.873340+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:32:57.022023+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:37:23.837136+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:37:26.988164+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:37:30.100542+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:41:10.273617+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:41:13.463502+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:41:16.537910+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:45:52.321781+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:45:55.400635+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:45:58.480517+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:55:59.640637+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:56:02.760446+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T21:56:05.860189+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T22:06:52.461199+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T22:06:55.720976+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T22:06:58.808397+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T22:35:44.623478+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T22:35:47.761619+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T22:35:50.873244+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T22:43:15.998016+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T22:47:55.984904+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T23:58:20.602036+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T23:58:23.740885+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-22T23:58:26.961507+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T04:44:53.910010+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T04:44:57.137262+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T04:45:00.371697+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:18:56.065382+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:18:59.409515+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:19:02.693594+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:24:41.354814+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:24:44.493838+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:24:47.623084+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:45:09.827641+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:45:13.159876+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:45:16.429767+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:48:32.325231+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:48:32.352561+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:48:32.370400+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:48:48.695685+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:48:48.721561+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:48:48.739033+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:49:51.923228+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:49:51.945531+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:49:51.962702+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:50:44.495653+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:50:44.517940+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:50:44.535139+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:51:02.523990+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:51:02.546244+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:51:02.563692+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:51:30.693064+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:51:30.715333+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T06:51:30.732614+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:05:03.722015+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:05:06.940826+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:05:10.070901+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:16:03.249418+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:16:03.272540+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:16:03.289641+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:23:15.824242+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:23:15.845858+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:23:15.861991+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:23:25.914915+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:23:25.936731+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:23:25.953650+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:24:50.781225+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:24:50.801117+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:24:50.817196+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:25:02.213131+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:25:02.235414+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:25:02.253281+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:27:16.272894+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:27:19.498998+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:27:22.751581+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:45:49.587050+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:45:52.825580+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:45:56.098136+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:49:20.783360+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:49:24.014701+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
- 2026-02-23T07:49:27.114426+00:00 | issue=STOP_VALIDATION_FAILED | count=1, reasons=required_fields_missing,low_unique_url_fraction, task=salesnav_search_account
