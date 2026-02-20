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
