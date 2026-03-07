# UI Architecture

> React + TypeScript desktop/mobile app built with Next.js, Tailwind CSS v4, TanStack Query, TanStack Table, and TanStack Virtual.

---

## Directory Structure

```
ui/src/
â”œâ”€â”€ api.ts                    # Centralized API client & shared TS types
â”œâ”€â”€ App.tsx                   # Root layout â€” sidebar, mobile tab bar, routing
â”œâ”€â”€ index.css                 # Tailwind v4 theme tokens (@theme block)
â”‚
â”œâ”€â”€ pages/                    # Top-level route components
â”‚   â”œâ”€â”€ Dashboard.tsx         # Stats, charts, live contacts, logs
â”‚   â”œâ”€â”€ Companies.tsx         # CRUD table with filters, virtual scroll
â”‚   â”œâ”€â”€ Contacts.tsx          # CRUD table with filters, bulk actions, virtual scroll
â”‚   â””â”€â”€ Email.tsx             # Campaign management, review queue, send queue
â”‚
â”œâ”€â”€ hooks/                    # Custom React hooks
â”‚   â”œâ”€â”€ useCompanies.ts       # React Query mutations for companies
â”‚   â”œâ”€â”€ useContacts.ts        # React Query queries + mutations for contacts
â”‚   â”œâ”€â”€ useDashboard.ts       # Aggregates stats, pipeline, email stats, today's contacts
â”‚   â”œâ”€â”€ useEmailCampaigns.ts  # React Query queries + mutations for email campaigns
â”‚   â”œâ”€â”€ useIsMobile.tsx       # Media query hook (< 768px)
â”‚   â””â”€â”€ useNotifications.ts   # Toast notification state management
â”‚
â”œâ”€â”€ types/
â”‚   â””â”€â”€ email.ts              # Email-specific types (campaigns, queue items, templates)
â”‚
â”œâ”€â”€ contexts/
â”‚   â””â”€â”€ NotificationContext.tsx # App-wide notification provider
â”‚
â”œâ”€â”€ components/
â”‚   â”œâ”€â”€ shared/               # â­ Reusable, domain-agnostic base components
â”‚   â”‚   â”œâ”€â”€ BaseModal.tsx
â”‚   â”‚   â”œâ”€â”€ SearchToolbar.tsx
â”‚   â”‚   â”œâ”€â”€ FilterPanelWrapper.tsx
â”‚   â”‚   â”œâ”€â”€ Badge.tsx
â”‚   â”‚   â”œâ”€â”€ PageHeader.tsx
â”‚   â”‚   â”œâ”€â”€ MobileCard.tsx
â”‚   â”‚   â”œâ”€â”€ EmptyState.tsx
â”‚   â”‚   â”œâ”€â”€ LoadingSpinner.tsx
â”‚   â”‚   â””â”€â”€ ConfirmDialog.tsx
â”‚   â”‚
â”‚   â”œâ”€â”€ companies/            # Company-specific components
â”‚   â”‚   â”œâ”€â”€ AddCompanyModal.tsx
â”‚   â”‚   â”œâ”€â”€ CompaniesFilterPanel.tsx
â”‚   â”‚   â”œâ”€â”€ CompanyCard.tsx       # Mobile card (wraps MobileCard)
â”‚   â”‚   â”œâ”€â”€ CompanyDetail.tsx     # Expanded row / detail view
â”‚   â”‚   â”œâ”€â”€ StatusBadge.tsx       # Wraps Badge
â”‚   â”‚   â”œâ”€â”€ TierBadge.tsx         # Wraps Badge
â”‚   â”‚   â””â”€â”€ tableColumns.tsx      # TanStack Table column definitions
â”‚   â”‚
â”‚   â”œâ”€â”€ contacts/             # Contact-specific components
â”‚   â”‚   â”œâ”€â”€ AddContactPanelContent.tsx
â”‚   â”‚   â”œâ”€â”€ BulkActionsBar.tsx
â”‚   â”‚   â”œâ”€â”€ CampaignEnrollmentModal.tsx
â”‚   â”‚   â”œâ”€â”€ ContactCard.tsx       # Mobile card (wraps MobileCard)
â”‚   â”‚   â”œâ”€â”€ ContactDetail.tsx
â”‚   â”‚   â”œâ”€â”€ FilterPanel.tsx
â”‚   â”‚   â”œâ”€â”€ SalesforceStatusBadge.tsx  # Wraps Badge
â”‚   â”‚   â””â”€â”€ tableColumns.tsx
â”‚   â”‚
â”‚   â”œâ”€â”€ email/                # Email campaign components
â”‚   â”‚   â”œâ”€â”€ CampaignCard.tsx
â”‚   â”‚   â”œâ”€â”€ CampaignModal.tsx     # Create/edit campaign (wraps BaseModal)
â”‚   â”‚   â”œâ”€â”€ CampaignsView.tsx
â”‚   â”‚   â”œâ”€â”€ QueueView.tsx
â”‚   â”‚   â”œâ”€â”€ ReviewQueueView.tsx
â”‚   â”‚   â”œâ”€â”€ SentEmailsList.tsx
â”‚   â”‚   â”œâ”€â”€ SettingsPanel.tsx
â”‚   â”‚   â””â”€â”€ TemplateEditorModal.tsx  # Wraps BaseModal
â”‚   â”‚
â”‚   â”œâ”€â”€ dashboard/            # Dashboard widgets
â”‚   â”‚   â”œâ”€â”€ ConnectionStatus.tsx
â”‚   â”‚   â”œâ”€â”€ LiveContacts.tsx
â”‚   â”‚   â”œâ”€â”€ MiniLineChart.tsx
â”‚   â”‚   â”œâ”€â”€ MiniMetric.tsx
â”‚   â”‚   â”œâ”€â”€ RecentActivity.tsx
â”‚   â”‚   â”œâ”€â”€ StatCard.tsx
â”‚   â”‚   â””â”€â”€ TerminalOutput.tsx
â”‚   â”‚
â”‚   â”œâ”€â”€ DataTable.tsx         # Generic table (used by non-virtual simple tables)
â”‚   â”œâ”€â”€ Notification.tsx      # Single toast notification
â”‚   â””â”€â”€ NotificationContainer.tsx
```

---

## Key Patterns

### 1. Shared Components (Composition, Not Inheritance)

All shared components live in `components/shared/` and are **"dumb"** â€” they know nothing about companies, contacts, or emails. They only know about UI patterns.

Domain-specific components **wrap** shared components:

```
AddCompanyModal  â†’  BaseModal        (provides overlay, header, body, footer)
TierBadge        â†’  Badge            (provides pill styling + color map)
CompanyCard      â†’  MobileCard       (provides checkbox, expand/collapse, chevron)
FilterPanel      â†’  FilterPanelWrapper (provides mobile bottom sheet / desktop dropdown)
```

This wrapper pattern avoids prop explosion. If a shared component starts needing `renderCustomHeader` with 5 boolean flags, it's gone too far â€” split into a new wrapper instead.

### 2. Data Fetching

All server communication goes through `api.ts`, which wraps `fetch` with typed helpers.

**React Query** (TanStack Query) manages caching and refetching:
- **Queries** (`useQuery`) â€” `getCompanies`, `getContacts`, `getStats`, etc.
- **Mutations** (`useMutation`) â€” `addCompany`, `deleteCompany`, etc.
- Query invalidation happens inside mutation `onSuccess` handlers.

Custom hooks (`useCompanies`, `useContacts`, `useDashboard`, `useEmailCampaigns`) encapsulate all query/mutation logic for each domain.

### 3. Tables

The Companies and Contacts pages use **TanStack Table** for:
- Column definitions (in `tableColumns.tsx`)
- Global filtering, column filtering, sorting
- Row selection (checkboxes)
- Row expansion (detail panels)

Combined with **TanStack Virtual** for virtualized scrolling (handles thousands of rows efficiently).

On **mobile** (`< 768px`), tables switch to a card-based layout using `MobileCard`.

### 4. Responsive Design

- **Desktop**: Sidebar nav + main content area
- **Mobile** (`< 768px`): Bottom tab bar + full-width content
- `useIsMobile()` hook provides the breakpoint flag
- Most components use `md:` Tailwind prefixes for responsive styling
- Filter panels become bottom sheets on mobile
- Modals slide up from bottom on mobile, center on desktop

### 5. Notifications

`NotificationContext` + `useNotificationContext()` provides app-wide toast notifications:
- `showSuccess("message")`
- `showError("message")`
- `showLoading("message")`

Used in mutation `onSuccess` / `onError` callbacks.

### 6. Theming

Tailwind CSS v4 with custom theme tokens defined in `index.css`:

| Token | Usage |
|-------|-------|
| `bg` | Page background |
| `surface` | Cards, panels, modals |
| `surface-hover` | Hover state for surface elements |
| `border` / `border-subtle` | Borders |
| `text` / `text-muted` / `text-dim` | Text hierarchy |
| `accent` / `accent-hover` | Primary action color (indigo) |
| `success` / `warning` / `error` | Semantic colors |

### 7. Confirm Dialogs

Destructive actions use `ConfirmDialog` (in `shared/`) instead of `window.confirm()`. It renders a themed modal with cancel/confirm buttons and supports `variant="danger"` for red styling.

---

## Adding a New Feature

### New Entity Page (e.g. "Deals")

1. **Types**: Add types to `api.ts` (or a new `types/deals.ts` for complex types)
2. **API**: Add endpoints to `api.ts`
3. **Hook**: Create `hooks/useDeals.ts` with React Query queries + mutations
4. **Table Columns**: Create `components/deals/tableColumns.tsx`
5. **Components**: Create domain-specific components in `components/deals/`, wrapping shared components as needed
6. **Page**: Create `pages/Deals.tsx` â€” compose the page from your new components
7. **Route**: Add a Next.js route under `app/(workspace)/` and wire any shell nav item updates in `components/shell/ChatFirstShell.tsx`

### New Shared Component

1. Create in `components/shared/`
2. Keep it **domain-agnostic** (no imports from `companies/`, `contacts/`, etc.)
3. Add JSDoc with `@example`
4. Export the props type for consumers that need to extend it

---

## Tech Stack

| Library | Version | Purpose |
|---------|---------|---------|
| React | 19.x | UI framework |
| TypeScript | 5.9.x | Type safety |
| Next.js | 15.x | Build tool + dev server |
| Tailwind CSS | 4.x | Utility-first styling |
| TanStack Query | 5.x | Server state management |
| TanStack Table | 8.x | Headless table logic |
| TanStack Virtual | 3.x | Virtualized lists/tables |
| lucide-react | 0.562+ | Icons |

