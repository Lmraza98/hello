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
