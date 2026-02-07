# UI Architecture

> React + TypeScript desktop/mobile app built with Vite, Tailwind CSS v4, TanStack Query, TanStack Table, and TanStack Virtual.

---

## Directory Structure

```
ui/src/
├── api.ts                    # Centralized API client & shared TS types
├── App.tsx                   # Root layout — sidebar, mobile tab bar, routing
├── index.css                 # Tailwind v4 theme tokens (@theme block)
│
├── pages/                    # Top-level route components
│   ├── Dashboard.tsx         # Stats, charts, live contacts, logs
│   ├── Companies.tsx         # CRUD table with filters, virtual scroll
│   ├── Contacts.tsx          # CRUD table with filters, bulk actions, virtual scroll
│   └── Email.tsx             # Campaign management, review queue, send queue
│
├── hooks/                    # Custom React hooks
│   ├── useCompanies.ts       # React Query mutations for companies
│   ├── useContacts.ts        # React Query queries + mutations for contacts
│   ├── useDashboard.ts       # Aggregates stats, pipeline, email stats, today's contacts
│   ├── useEmailCampaigns.ts  # React Query queries + mutations for email campaigns
│   ├── useIsMobile.tsx       # Media query hook (< 768px)
│   └── useNotifications.ts   # Toast notification state management
│
├── types/
│   └── email.ts              # Email-specific types (campaigns, queue items, templates)
│
├── contexts/
│   └── NotificationContext.tsx # App-wide notification provider
│
├── components/
│   ├── shared/               # ⭐ Reusable, domain-agnostic base components
│   │   ├── BaseModal.tsx
│   │   ├── SearchToolbar.tsx
│   │   ├── FilterPanelWrapper.tsx
│   │   ├── Badge.tsx
│   │   ├── PageHeader.tsx
│   │   ├── MobileCard.tsx
│   │   ├── EmptyState.tsx
│   │   ├── LoadingSpinner.tsx
│   │   └── ConfirmDialog.tsx
│   │
│   ├── companies/            # Company-specific components
│   │   ├── AddCompanyModal.tsx
│   │   ├── CompaniesFilterPanel.tsx
│   │   ├── CompanyCard.tsx       # Mobile card (wraps MobileCard)
│   │   ├── CompanyDetail.tsx     # Expanded row / detail view
│   │   ├── StatusBadge.tsx       # Wraps Badge
│   │   ├── TierBadge.tsx         # Wraps Badge
│   │   └── tableColumns.tsx      # TanStack Table column definitions
│   │
│   ├── contacts/             # Contact-specific components
│   │   ├── AddContactModal.tsx
│   │   ├── BulkActionsBar.tsx
│   │   ├── CampaignEnrollmentModal.tsx
│   │   ├── ContactCard.tsx       # Mobile card (wraps MobileCard)
│   │   ├── ContactDetail.tsx
│   │   ├── FilterPanel.tsx
│   │   ├── SalesforceStatusBadge.tsx  # Wraps Badge
│   │   └── tableColumns.tsx
│   │
│   ├── email/                # Email campaign components
│   │   ├── CampaignCard.tsx
│   │   ├── CampaignModal.tsx     # Create/edit campaign (wraps BaseModal)
│   │   ├── CampaignsView.tsx
│   │   ├── QueueView.tsx
│   │   ├── ReviewQueueView.tsx
│   │   ├── SentEmailsList.tsx
│   │   ├── SettingsPanel.tsx
│   │   └── TemplateEditorModal.tsx  # Wraps BaseModal
│   │
│   ├── dashboard/            # Dashboard widgets
│   │   ├── ConnectionStatus.tsx
│   │   ├── LiveContacts.tsx
│   │   ├── MiniLineChart.tsx
│   │   ├── MiniMetric.tsx
│   │   ├── RecentActivity.tsx
│   │   ├── StatCard.tsx
│   │   └── TerminalOutput.tsx
│   │
│   ├── DataTable.tsx         # Generic table (used by non-virtual simple tables)
│   ├── Notification.tsx      # Single toast notification
│   └── NotificationContainer.tsx
```

---

## Key Patterns

### 1. Shared Components (Composition, Not Inheritance)

All shared components live in `components/shared/` and are **"dumb"** — they know nothing about companies, contacts, or emails. They only know about UI patterns.

Domain-specific components **wrap** shared components:

```
AddCompanyModal  →  BaseModal        (provides overlay, header, body, footer)
TierBadge        →  Badge            (provides pill styling + color map)
CompanyCard      →  MobileCard       (provides checkbox, expand/collapse, chevron)
FilterPanel      →  FilterPanelWrapper (provides mobile bottom sheet / desktop dropdown)
```

This wrapper pattern avoids prop explosion. If a shared component starts needing `renderCustomHeader` with 5 boolean flags, it's gone too far — split into a new wrapper instead.

### 2. Data Fetching

All server communication goes through `api.ts`, which wraps `fetch` with typed helpers.

**React Query** (TanStack Query) manages caching and refetching:
- **Queries** (`useQuery`) — `getCompanies`, `getContacts`, `getStats`, etc.
- **Mutations** (`useMutation`) — `addCompany`, `deleteCompany`, etc.
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
6. **Page**: Create `pages/Deals.tsx` — compose the page from your new components
7. **Route**: Add to `App.tsx` navItems + page render

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
| Vite | 7.x | Build tool + dev server |
| Tailwind CSS | 4.x | Utility-first styling |
| TanStack Query | 5.x | Server state management |
| TanStack Table | 8.x | Headless table logic |
| TanStack Virtual | 3.x | Virtualized lists/tables |
| lucide-react | 0.562+ | Icons |
