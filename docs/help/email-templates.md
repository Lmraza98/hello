---
summary: "How to use the new Templates tab, token syntax, validation, and campaign linking modes."
read_when:
  - You are creating reusable email templates
  - You need token and validation behavior details
title: "Email Templates"
---

# Email Templates

The app now includes a standalone `Templates` tab (`/templates`) for reusable email templates.

## What You Can Do

- Create, edit, duplicate, and archive reusable templates.
- Manage headers: subject, preheader, from name/email, reply-to.
- Edit HTML + optional plain text body.
- Insert reusable blocks/snippets.
- Render preview for a sample contact.
- Validate template issues before use.
- Export/import template JSON.
- View revisions and revert to a prior revision.

## Workspace Interaction

- The Templates page now follows the Contacts interaction model.
- The template list uses the same table styling pattern as Contacts.
- The Templates workspace hides the redundant page title and uses a single inline controls row for search, status filtering, and actions.
- Selecting a template opens an editor/details pane on the right (desktop) or a bottom drawer (mobile).
- Creating a template opens the same pane immediately.
- Updating via assistant actions (`templates.update`, `templates.test_send`, etc.) routes with `selectedTemplateId` and opens that template in the pane.

## Email Workspace Tabs

- The `Review`, `Scheduled`, and `Sent History` tabs under `/email` now use the same standardized table-and-details layout as the Contacts and Templates pages.
- Selecting a row opens email details in the right-side panel on desktop or a bottom drawer on mobile.
- The selected email is tracked in the route with `selectedEmailId`, so tab state and detail state stay aligned with the URL.
- Approving from `Review` immediately refreshes the `Scheduled` table state, and send/reschedule actions refresh both `Scheduled` and `Sent History` data.
- The email workspace hides the redundant page title and uses a single inline controls row for search plus tab-specific actions.

## Token Syntax

Supported tokens:

- `{{firstName}}`, `{{lastName}}`, `{{fullName}}`
- `{{email}}`, `{{company}}`, `{{title}}`, `{{industry}}`, `{{location}}`
- `{{unsubscribeUrl}}`, `{{viewInBrowserUrl}}`, `{{trackingPixel}}`, `{{campaignName}}`

Fallback syntax:

- `{{firstName | "there"}}`
- `{{company | ""}}`

Optional conditional syntax:

- `{{#if firstName}}Hi {{firstName}}{{else}}Hi there{{/if}}`

## Validation Rules

Blocking errors:

- Subject is required.
- `fromEmail` must be a valid email format when provided.
- `{{unsubscribeUrl}}` must exist in the HTML body.

Warnings:

- Unknown tokens.
- Empty `<a href="">` links.
- Unresolved tokens after render.

## Campaign Integration Modes

Campaigns support two modes:

- `copied`: campaign uses existing step templates (`email_templates` table).
- `linked`: campaign references a template-library item (`template_id`) and renders that template per contact.

Use campaign edit/create flow to choose mode and linked template.

## API Endpoints

Key routes under `/api/emails`:

- `/templates` + `/templates/{id}` CRUD
- `/templates/{id}/render`
- `/templates/{id}/validate`
- `/templates/{id}/revisions` and `/templates/{id}/revert`
- `/templates/{id}/duplicate`, `/templates/{id}/archive`
- `/templates/{id}/export`, `/templates/import`
- `/template-blocks` CRUD
- `/campaigns/{id}/template-link`

## Assistant Actions

The chat assistant can execute template workflows through capability actions:

- `templates.navigate`
- `templates.search`
- `templates.create`
- `templates.update`
- `templates.duplicate`
- `templates.archive`
- `templates.validate`
- `templates.test_send`

These actions call template APIs directly and route to `/templates` with query context (`q`, `status`, `selectedTemplateId`) when applicable.
