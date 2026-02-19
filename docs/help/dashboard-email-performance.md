---
summary: "Dashboard Email Performance UX: campaign/template mode toggle, summary strip, and drilldown slide-over."
read_when:
  - You are modifying dashboard email metrics
  - You need to understand performance drilldown interactions
title: "Dashboard Email Performance"
---

# Dashboard Email Performance

The Dashboard email module now keeps campaign/template insights inside the existing `Email Performance` section without adding new large cards.

## UX Structure

- `Performance by` mode toggle: `Overall`, `Campaign`, `Template`
- Compact `Top Campaign/Top Template` summary strip
- Existing KPI micro-metrics updated in-place
- Existing compact chart reused with focused/faded series
- Right-side slide-over for campaign/template drilldown

No additional major dashboard sections were introduced.

## Interactions

- Clicking KPI tiles (`Sent`, `Viewed`, `Responded`) filters chart emphasis.
- Clicking summary strip entity name opens slide-over details.
- Drilldown panel supports:
  - Campaign view: template usage and reply-rate by template
  - Template view: campaigns using template and reply-rate by campaign
- Empty state is inline inside Email Performance:
  - `No campaigns yet. Create your first campaign.`

## Data Sources

Dashboard now uses:

- `/api/emails/dashboard-metrics` (existing aggregate metrics)
- Campaign list via existing email campaigns API
- Sent-email history sample for campaign/template aggregation (last 500 rows)

## Components Added

- `ui/src/pages/dashboard/PerformanceModeToggle.tsx`
- `ui/src/pages/dashboard/CampaignSummaryStrip.tsx`
- `ui/src/pages/dashboard/SlideOverPanel.tsx`
- `ui/src/pages/dashboard/EmailPerformanceSection.tsx`
- `ui/src/pages/dashboard/PerformanceDrilldownContent.tsx`
- `ui/src/pages/dashboard/DashboardStatsGrid.tsx`
- `ui/src/pages/dashboard/DashboardWorkspaceGrid.tsx`
- `ui/src/pages/dashboard/performanceUtils.ts`

## Composition Notes

- `ui/src/pages/Dashboard.tsx` now orchestrates state/data wiring and delegates rendering to focused components.
- Email performance UI is encapsulated in `EmailPerformanceSection` for easier capability targeting and maintenance.
- Slide-over body content is isolated in `PerformanceDrilldownContent` so interaction logic can evolve separately from layout.
- Shared aggregation/formatting utilities moved to `performanceUtils` to avoid duplicated logic and simplify testing.

## Chart Behavior

- `MiniLineChart` supports:
  - optional secondary baseline series (`secondaryData`) for faded context
  - optional metric emphasis (`focusMetric`) for line fading
