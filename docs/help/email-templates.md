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
- The Templates workspace hides the redundant page title and uses a single inline controls row for search and actions.
- The `Status` filter now lives inside the `Status` table header, matching the Contacts header-filter pattern instead of using a toolbar dropdown.
- The Templates list and email workspace tables now also use the same leading selection column pattern as Contacts.
- Selecting a template opens an editor/details pane on the right (desktop) or a bottom drawer (mobile).
- Creating a template opens the same pane immediately.
- Updating via assistant actions (`templates.update`, `templates.test_send`, etc.) routes with `selectedTemplateId` and opens that template in the pane.

## Email Workspace Tabs

- The `Review`, `Scheduled`, and `Sent History` tabs under `/email` now use the same standardized table-and-details layout as the Contacts and Templates pages.
- The `Campaigns` table and the `Templates` list now use the same shared resizable desktop table foundation too, so all major email workspace tables share one column-sizing model.
- Selecting a row opens email details in the right-side panel on desktop or a bottom drawer on mobile.
- The selected email is tracked in the route with `selectedEmailId`, so tab state and detail state stay aligned with the URL.
- Approving from `Review` immediately refreshes the `Scheduled` table state, and send/reschedule actions refresh both `Scheduled` and `Sent History` data.
- The email workspace hides the redundant page title and uses a single inline controls row for search plus tab-specific actions.
- Review, Scheduled, and Sent History now share the same Airtable-like resizable desktop table foundation with column metadata, subtle vertical separators, header-only resize handles, and per-view width persistence (`review-table`, `scheduled-table`, `history-table`).
- Campaigns and Templates also persist desktop column widths with stable local keys: `campaigns-table` and `templates-table`.
- When a table cannot show every desktop column at once, inline chevrons in the header let you page the visible column window without adding a horizontal scrollbar.
- The shared column navigator now keeps the leftmost visible prefix fixed and rotates only the trailing visible slot through the remaining headers.
- Visible columns stop resizing before the inline navigator area, so drag resizing cannot push headers under the chevrons.
- The `Visible Columns` menu on desktop Campaign tables now also controls column order, and the menu order matches the actual header order.
- The Campaigns desktop `Visible Columns` control now lives inline at the right edge of the table header, just left of the chevrons, and column resizing stops before that control strip.
- The Email and Templates workspaces now follow the same Contacts-style tabs, toolbar spacing, square controls, and desktop table height/chrome treatment.

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
