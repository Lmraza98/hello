---
name: campaign-create-and-enroll
description: Create an email campaign and enroll contacts matching an industry/vertical filter
version: 1
tags:
  - campaign
  - enrollment
  - bulk
trigger_patterns:
  - "create campaign"
  - "create an email campaign"
  - "new campaign"
  - "sequence targeting"
  - "and add contacts"
  - "and enroll"
  - "targeting {industry}"
  - "campaign targeting"
allowed_tools:
  - create_campaign
  - enroll_contacts_by_filter
  - list_campaigns
  - get_campaign
  - list_filter_values
extract_fields:
  - name: industry
    description: Industry/vertical keyword for contact filter (e.g. "banks", "construction", "veterinary")
    required: true
  - name: campaign_name
    description: Campaign name (defaults to "<Industry> Outreach")
    required: false
  - name: num_emails
    description: Number of emails in the sequence
    required: false
  - name: days_between_emails
    description: Days between emails
    required: false
confirmation_policy: ask_writes
---

## Procedure

1. Extract the industry keyword from the user message.
2. Derive campaign name: if user provided one, use it; otherwise default to `"<Industry> Outreach"`.
3. Call `create_campaign` with the name, description, and optional sequence params.
4. **Confirmation gate**: present the campaign creation plan to the user. Wait for confirmation.
5. After campaign is created, call `enroll_contacts_by_filter` with `{ campaign_id, query: <industry> }`.
6. **Confirmation gate**: present the enrollment plan. Wait for confirmation.
7. Return a human-readable summary with campaign ID, enrollment counts, and next suggested actions.

## Important

- NEVER ask the user for an array of contact IDs. Use `enroll_contacts_by_filter` with the `query` parameter.
- Use ONLY the `query` parameter for `enroll_contacts_by_filter`. Do NOT add `vertical`, `company`, or `has_email` unless the user explicitly requested those filters.
- If the campaign already exists (duplicate detection returns 409), use the existing campaign's ID.
