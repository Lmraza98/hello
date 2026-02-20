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

### Documents (`/documents`)

Document storage, processing, linking, and retrieval workspace.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `documents.navigate` | Navigate to document library page | - | - |
| `documents.search` | Set free-text document query | `q` (string) | - |
| `documents.select_row` | Select a document by id for inspector actions | `document_id` (string) | - |
| `documents.ask` | Run document RAG question over selected or all docs | `question` (string), `document_ids` (string[]?) | - |
| `documents.link_entities` | Confirm links between a document, company, and contacts | `document_id` (string), `company_id` (number?), `contact_ids` (number[]?) | - |
| `documents.retry_processing` | Retry extraction/chunking/embedding for a document | `document_id` (string) | - |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `documents.q` | search | Search by filename, summary, and text |

### Templates (`/templates`)

Create and manage reusable email templates, revisions, blocks, and test renders.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `templates.navigate` | Navigate to template library | - | - |
| `templates.search` | Filter templates by text | `q` (string) | - |
| `templates.create` | Create a new template with fields | `name` (string), `subject` (string), `html_body` (string), `preheader` (string?), `from_name` (string?), `from_email` (string?), `reply_to` (string?), `text_body` (string?) | - |
| `templates.update` | Update an existing template | `template_id` (number), `name` (string?), `subject` (string?), `html_body` (string?), `preheader` (string?), `from_name` (string?), `from_email` (string?), `reply_to` (string?), `text_body` (string?), `status` (string?) | - |
| `templates.duplicate` | Duplicate template by id | `template_id` (number) | - |
| `templates.archive` | Archive template by id | `template_id` (number) | - |
| `templates.validate` | Validate subject/html content | `subject` (string), `html` (string), `from_email` (string?) | - |
| `templates.test_send` | Render and run template test-send | `template_id` (number), `to_email` (string), `contact_id` (number?) | - |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `templates.q` | search | Search templates by name or content |
| `templates.status` | select | Filter by active/archived |

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

### Browser Workbench (`/browser`)

Live browser tabs with workflow-builder annotation and selector synthesis.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `browser.navigate` | Navigate to browser workbench page | - | - |
| `browser.observe` | Capture observation pack for selected tab | - | - |
| `browser.annotate` | Generate candidate boxes for the current href pattern | `href_pattern` (string) | - |
| `browser.synthesize` | Synthesize selector from include/exclude labels | - | - |
| `browser.validate` | Validate extracted results for the current candidate rule | - | - |

### Tasks (`/tasks`)

Browser and compound task monitor with status, progress, and errors.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `tasks.navigate` | Navigate to tasks monitor page | - | - |
| `tasks.filter_finished` | Show or hide finished tasks | `show_finished` (boolean) | - |

#### Filters

| Filter ID | Type | Description |
|-----------|------|-------------|
| `tasks.show_finished` | boolean | Include finished tasks in table |

### Workspace Surface (`/dashboard`)

Controls for opening, docking, and expanding the right workspace surface.

#### Actions

| Action ID | Description | Parameters | Conditions |
|-----------|-------------|------------|------------|
| `workspace.open` | Open the right workspace surface | - | - |
| `workspace.close` | Close the right workspace surface | - | - |
| `workspace.expand` | Expand the workspace into fullscreen mode | - | - |
| `workspace.dock` | Dock the workspace into drawer mode | - | - |

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
