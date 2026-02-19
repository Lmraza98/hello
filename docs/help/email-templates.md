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

## Token Syntax

Supported tokens:

- `{{firstName}}`, `{{lastName}}`, `{{fullName}}`
- `{{email}}`, `{{company}}`, `{{title}}`
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
