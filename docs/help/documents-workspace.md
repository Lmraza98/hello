---
summary: "Documents workspace layout, tree-table behavior, and inspector interaction model."
read_when:
  - You are modifying the Documents workspace UI
  - You need the current document tree and inspector behavior
title: "Documents Workspace"
---

# Documents Workspace

The Documents workspace now follows the same headerless page layout used by Email, Templates, and Contacts.

## Layout

- The page header is hidden so the workspace starts with a tab rail.
- Tabs follow the document-processing lifecycle: `All`, `Extracting`, `Chunking`, `Tagging`, `Ready`, and `Failed`.
- Search, filters, column controls, upload, folder creation, and refresh actions live in one inline controls row beneath the tabs.

## Behavior

- The document tree remains the primary list view, including folder expansion, drag/drop moves, rename flows, and inline folder creation.
- Desktop keeps the right-side inspector panel for document details.
- Mobile keeps the bottom-drawer document inspector.
- Selecting a document and switching tabs now use URL-backed view state so the workspace stays consistent while navigating.
- Document `Type` and `Status` filtering now lives inside those table headers instead of the top toolbar.
- Documents now default to `Files First` inside folders, and the toolbar includes a toggle so users can switch between `Files First` and `Folders First`.
- Dragging a file onto a sibling file now persists manual file order within that folder, and dragging a folder onto a sibling folder now persists manual folder order within that parent.
- Manual reorder now remains stable after the first move; the first item in a folder is no longer re-derived on later refreshes.
- Dragging a file or folder onto a folder in a different parent still moves it into that folder.
- Reorder drops now show a direct in-row placement indicator, while move-into-folder drops keep the folder highlight treatment.
- The reorder line is positional: a line above a row inserts before it, and a line below a row inserts after it. Dropping immediately below the currently selected item is now a no-op instead of swapping with the next row.
- A folder can no longer contain two documents with the same visible filename. Moves and renames now reject duplicates in the destination folder, and root-level uploads auto-suffix duplicate names.
- Document rows now include a delete action. Deleting a document opens a typed confirmation modal that requires `confirm delete` before the removal is allowed.
- The desktop tree table now uses the shared resizable column model (`Name`, `Type`, `Company`, `Status`, `Updated`) with live drag resizing, single-column auto-fit on double-click, and persistent widths under `documents-table`.
- The desktop tree table now keeps the `Name` cell single-line and exposes file metadata in dedicated columns, including `Size`.
- The Documents table now also uses the same leading selection column pattern as Contacts.
- The desktop `Visible Columns` menu now controls both visibility and column order, and that order matches the left-to-right table header order.
- The `Visible Columns` control now lives inline at the right edge of the desktop table header, just left of the chevrons, and desktop column resizing stops before that control strip.
- The Documents toolbar and desktop table chrome now follow the same Contacts-style pattern for tabs, search row spacing, square controls, and shared row/header height.
