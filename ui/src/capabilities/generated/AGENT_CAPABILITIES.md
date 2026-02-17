# UI Capabilities Reference

> Auto-generated. Do not edit manually.

## Pages

### Dashboard (`/dashboard`)

Operational overview for outreach volume, replies, scheduled sends, and recent conversations.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `dashboard.navigate` | Navigate to dashboard overview | - | - |
| `dashboard.poll_replies` | Trigger Outlook reply polling | - | - |
| `dashboard.mark_conversation_done` | Mark a conversation as handled | `reply_id` (number) | - |

### Companies (`/companies`)

Manage target companies for outreach. View, filter, add, import, and delete prospect companies.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `companies.navigate` | Navigate to companies list | - | - |
| `companies.search` | Set free-text query filter | `q` (string) | - |
| `companies.filter_vertical` | Filter by company vertical | `vertical` (string) | - |
| `companies.filter_tier` | Filter by company tier | `tier` (string) | - |
| `companies.expand_row` | Select/expand company detail panel | `company_id` (number) | - |
| `companies.delete_selected` [destructive] | Permanently delete selected companies | `company_ids` (number[]) | At least one company must be selected |
| `companies.reset_all` [destructive] | Reset all company status values | - | - |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `companies.q` | search | Search by name/domain/vertical |
| `companies.vertical` | multi_select | Filter by industry vertical |
| `companies.tier` | multi_select | Filter by company tier |

### Contacts (`/contacts`)

Manage contact records and run bulk outreach actions.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `contacts.navigate` | Navigate to contacts page | - | - |
| `contacts.search` | Set contacts query filter | `q` (string) | - |
| `contacts.filter_company` | Filter contacts by company | `company` (string) | - |
| `contacts.filter_vertical` | Filter contacts by vertical | `vertical` (string) | - |
| `contacts.select_row` | Select a contact row by id | `contact_id` (number) | - |
| `contacts.bulk_delete` [destructive] | Delete selected contacts | `contact_ids` (number[]) | At least one contact must be selected |
| `contacts.bulk_send_email` | Send campaign emails to selected contacts | `contact_ids` (number[]) | At least one contact must be selected |
| `contacts.bulk_linkedin_request` | Send LinkedIn requests to selected contacts | `contact_ids` (number[]) | At least one contact must be selected |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `contacts.q` | search | Search by name/company/title/email |
| `contacts.company` | multi_select | Filter by company |
| `contacts.vertical` | multi_select | Filter by vertical |
| `contacts.hasEmail` | boolean | Filter to contacts with email |

### Email Campaigns (`/email?view=campaigns`)

Create and manage campaigns, activation, templates, and sends.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `email.campaigns.navigate` | Navigate to email campaigns view | - | - |
| `email.campaigns.create` | Open create campaign modal | - | - |
| `email.campaigns.activate` | Activate a campaign by id | `campaign_id` (number) | - |
| `email.campaigns.pause` | Pause a campaign by id | `campaign_id` (number) | - |

### Email Review Queue (`/email?view=review`)

Review and approve pending generated emails.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `email.review.navigate` | Navigate to review queue | - | - |
| `email.review.approve` | Approve one pending email | `email_id` (number) | - |
| `email.review.reject` | Reject one pending email | `email_id` (number) | - |

### Scheduled Emails (`/email?view=scheduled`)

View and reorder scheduled outgoing emails.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `email.scheduled.navigate` | Navigate to scheduled emails | - | - |
| `email.scheduled.send_now` | Send a scheduled email immediately | `email_id` (number) | - |

### Sent Email History (`/email?view=history`)

Browse historical sent email records.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `email.history.navigate` | Navigate to sent history view | - | - |

### BI Overview (`/bi?tab=overview`)

BI health, freshness, and ingestion summary.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `bi.navigate_overview` | Navigate to BI overview tab | - | - |

### BI Sources (`/bi?tab=sources`)

Per-source ingestion status and configuration controls.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `bi.navigate_sources` | Navigate to BI sources tab | - | - |
| `bi.save_source_config` | Persist BI source settings | - | - |

### BI Runs (`/bi?tab=runs`)

Historical BI ingestion runs and counts.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `bi.navigate_runs` | Navigate to BI runs tab | - | - |
| `bi.filter_run_status` | Filter runs by status | `status` (string) | - |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `bi.runs.status` | select | Filter by run status |

### BI Companies (`/bi?tab=companies`)

Company-level BI coverage and signal detail.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `bi.navigate_companies` | Navigate to BI companies tab | - | - |
| `bi.search_company` | Filter BI companies by query | `query` (string) | - |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `bi.companies.query` | search | Search by company/domain |

### BI Events (`/bi?tab=events`)

Raw source event stream for auditing collection behavior.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `bi.navigate_events` | Navigate to BI events tab | - | - |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `bi.events.source` | search | Filter by source |
| `bi.events.ok` | select | Filter by success/failure |

### BI Errors (`/bi?tab=errors`)

Top error categories and samples by source.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `bi.navigate_errors` | Navigate to BI errors tab | - | - |

### Tasks (`/tasks`)

Live browser task monitor with task table and per-tab screenshots.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `tasks.navigate` | Navigate to tasks monitor page | - | - |
| `tasks.filter_finished` | Show or hide finished tasks | `show_finished` (boolean) | - |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `tasks.show_finished` | boolean | Include finished tasks in table |

### Admin Logs (`/admin/logs`)

Operational logs explorer with correlation and filters.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `admin.navigate_logs` | Navigate to admin logs | - | - |
| `admin.logs.search` | Filter logs by query text | `q` (string) | - |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `admin.logs.q` | search | Search message text |
| `admin.logs.level` | select | Filter log level |

### Admin Costs (`/admin/costs`)

Cost breakdown by feature, provider/model, and expensive requests.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `admin.navigate_costs` | Navigate to admin costs | - | - |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `admin.costs.range` | select | Cost range filter |

### Admin Fine-tune (`/admin/finetune`)

Label function-calling failures and export training datasets.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `admin.navigate_finetune` | Navigate to fine-tune tooling | - | - |
| `admin.finetune.export_split` | Export train/test split for fine-tuning | - | - |
| `admin.finetune.clear_all` [destructive] | Delete all failure captures and labels | - | - |

### Admin Tests (`/admin/tests`)

Run planner regression suite and tool-example override workflows.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `admin.navigate_tests` | Navigate to planner tests | - | - |
| `admin.tests.run_suite` | Run built-in planner test suite | - | - |
