---
summary: "Contacts workspace layout, tabs, shared table behavior, and detail-panel interaction model."
read_when:
  - You are modifying the Contacts workspace UI
  - You need current table and detail-panel behavior
title: "Contacts Workspace"
---

# Contacts Workspace

The Contacts workspace now follows the same headerless page pattern used by Email and Templates.

## Layout

- The page header is hidden so the workspace starts with the tab rail.
- Tabs are `All Contacts`, `Sources`, and `Pipeline / Status`.
- The active tab omits its bottom border, and only the first active tab omits its left border, so the rail stays aligned without doubling adjacent seams.
- Search, filters, bulk actions, export, new contact, and column visibility all live in one inline controls row beneath the tabs.
- On desktop, that controls row now belongs to the left table pane itself, so when the details rail is open the controls stop at the table boundary and the rail begins on the same top line.
- Desktop column filters now live inside the relevant table headers instead of beside the search field, keeping the toolbar minimal.
- The sticky toolbar now sits flush with the workspace content, without the extra bottom spacing that previously separated it from the table.
- The Contacts toolbar row is now tighter: the search input matches the height of the other controls, the control gap is removed, and the table region no longer adds extra top padding beneath the toolbar.
- The shared shell content wrapper no longer adds horizontal or bottom padding, and the Contacts workspace no longer adds the extra shell `overflow-hidden` wrapper class there, so the table aligns flush edge-to-edge.

## Views

- `All Contacts` keeps the standard contacts table and detail rail as the default workspace.
- `Sources` reuses the same table but focuses the view around `lead_source` filtering.
- `Pipeline / Status` reuses the same table but focuses the view around `engagement_status` filtering.

## Interaction Model

- Desktop keeps the split layout with the standardized table on the left and the contact detail panel on the right.
- The desktop contact details panel is now activity-first: the top area is reduced to a single sticky action strip, email/phone actions live in that row, the activity log owns the main scrollable region with a sticky `Activity` header, and secondary contact metadata sits in a quieter collapsible `Details` section at the bottom.
- The header metadata line is now smaller and lighter than the name/title lines, and the rail container is locked so only the activity list scrolls while the identity strip, actions, and `Activity` header remain fixed.
- The header action strip now uses the same row-height rhythm as the table and the rail action buttons use the same flat, square treatment as the surrounding workspace controls.
- The contact details rail now uses the same left/right content inset as the desktop table cells, so the activity log and metadata align to the same grid rhythm as the main table.
- The `Activity` header now uses the same flat shared-header box model as the table headers, instead of a looser custom padded wrapper.
- The activity log now uses dedicated table-like columns for type, summary, date, and status, with step information folded into the summary column, and the status filter now lives in the header as a small icon-triggered filter menu instead of a standalone dropdown.
- The Activity grid now resizes like the Contacts table but stays fit to the detail pane width, with the summary column absorbing remaining space instead of introducing horizontal scrolling.
- Mobile keeps the compact contact cards and bottom drawer detail view.
- The selected contact still uses route state, so switching rows updates the URL-backed detail state consistently.
- When a desktop contact is selected, the table animates that contact to the top of the visible table pane over roughly one second so the movement happens in step with the details rail opening.
- Desktop columns now use a shared resizable data-table system with explicit column definitions, subtle vertical dividers, hover-only resize handles, and double-click auto-fit per column.
- Shared desktop table headers now use the same white background as the body rows with flat, square dividers for a more spreadsheet-like treatment.
- Shared desktop table headers now also include a 2px top border.
- The Contacts search/filter/action controls now use the same flatter, square-edged treatment so the toolbar reads as part of the table grid instead of a separate rounded control bar.
- The desktop Contacts table header and rows now use a shared visual height that accounts for the row divider, so they align with the 32px search/filter controls.
- Shared table headers now remove extra inner vertical padding so the Contacts header height matches the row height exactly rather than rendering a few pixels taller.
- Shared scrollbar tracks and corners now stay transparent instead of falling back to a white native track background.
- The desktop Contacts table now hides the native vertical scrollbar and uses a minimal custom pill thumb instead.
- Contact column widths persist in local storage under the stable key `contacts-table`.
- The Contacts desktop column menu now includes `First Name` and `Last Name` in addition to the combined `Name` field.
- The `Source` column now renders as regular text instead of a pill badge.
- Row selection now uses its own leading column: the top-left header cell is a blank select-all target, while body cells are blank click targets that toggle contact selection.
- The desktop `Visible Columns` menu now controls both visibility and column order, and that order matches the left-to-right table header order.
- The `Visible Columns` control now lives inline at the right edge of the desktop table header, just left of the chevrons, and desktop column resizing stops before that control strip.
- For non-leading visible columns, resizing now preserves the visible columns to their left and only consumes the remaining usable width before the header control strip.
- Filterable desktop Contacts headers now expose small in-header filter controls for fields like first name, last name, title, company, source, and status.
- Desktop column resizing is no longer capped by a shared max width, so a widened column can take over the table viewport and push later columns out of view.
