# Contacts Workspace

The Contacts workspace now follows the same headerless page pattern used by Email and Templates.

## Layout

- The page header is hidden so the workspace starts with the tab rail.
- Tabs are `All Contacts`, `Sources`, and `Pipeline / Status`.
- Search, filters, bulk actions, export, new contact, and column visibility all live in one inline controls row beneath the tabs.

## Views

- `All Contacts` keeps the standard contacts table and detail rail as the default workspace.
- `Sources` reuses the same table but focuses the view around `lead_source` filtering.
- `Pipeline / Status` reuses the same table but focuses the view around `engagement_status` filtering.

## Interaction Model

- Desktop keeps the split layout with the standardized table on the left and the contact detail panel on the right.
- Mobile keeps the compact contact cards and bottom drawer detail view.
- The selected contact still uses route state, so switching rows updates the URL-backed detail state consistently.
