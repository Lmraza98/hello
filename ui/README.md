# UI (Next.js + TypeScript)

This frontend runs on Next.js (App Router) with file-based routes under `src/app/(workspace)/*`.

## Scripts

- `npm run dev` - start Next.js dev server
- `npm run build` - production build
- `npm run start` - run production server
- `npm run test` - run Vitest test suite
- `npm run lint` - run ESLint
- `npm run generate:capabilities` - regenerate capability artifacts

## Environment Variables

Client-exposed variables must use the `NEXT_PUBLIC_` prefix (previously `VITE_`).

Examples:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_OLLAMA_URL`
- `NEXT_PUBLIC_TOOL_BRAIN`
- `NEXT_PUBLIC_CHAT_RUNTIME_ENABLED`

See `.env.example` for the full set used by the app.

## Routing Model

Next.js serves each page with file-based routes in `src/app/(workspace)`, and navigation uses Next router APIs from `next/navigation`.

## UI Conventions

- Base button sizing is standardized globally to match Contacts page controls (`h-8`, `px-3`, `rounded-md`, `text-xs`, `font-medium`).
- Pages can still override button size locally with explicit Tailwind utility classes when needed.
- Header action naming convention:
  - Primary create action: `New <Entity>` (for example: `New Contact`, `New Company`, `New Template`)
  - Secondary actions: imperative verbs (`Refresh`, `Export CSV`, `Import CSV`, `Upload Document`)
- Use `HeaderActionButton` for page-header actions so sizing and variants remain uniform.
- Primary `New <Entity>` header actions use a shared minimum width (`min-w-[9rem]`) for visual uniformity.
- Header action placement convention:
  - Place primary action as the rightmost action in `PageHeader.desktopActions`
  - Place compact equivalents in `PageHeader.mobileActions`
  - Keep search/filter controls in the header toolbar directly below `PageHeader` (outside data table cards)
- Use `WorkspacePageShell` for workspace pages to keep sticky header spacing and action alignment identical when switching routes.
