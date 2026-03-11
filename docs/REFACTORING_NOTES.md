---
summary: "Active refactoring notes for current behavior and operational workflows."
read_when:
  - You need the current architecture decisions quickly
  - You are debugging Contacts, Outlook inbound ingestion, or Salesforce sync
  - You want current launcher/browser gateway behavior
title: "Refactoring Notes"
---

# Refactoring Notes

This document is intentionally compact and only tracks active behavior.
For full historical detail, use git history:

- `git log -- docs/REFACTORING_NOTES.md`

## Current Focus Areas

1. Contacts UX stability and integrated details panel
2. Outlook inbound lead ingestion into Contacts
3. Single-contact Salesforce create sync for inbound leads
4. Camoufox-first runtime startup (no OpenClaw dependency)

## Contacts (Current Behavior)

- Contacts uses a responsive details architecture with a shared details content component:
  - desktop/tablet: right-side panel in normal layout flow
  - mobile: bottom drawer
- "New Contact" now uses that same responsive panel system instead of a standalone modal.
- Contact row selection is URL-synced via `?contactId=<id>`.
- Contacts top toolbar now keeps only:
  - global search input
- Contacts column visibility trigger (sliders icon) is now pinned in the rightmost table header cell (desktop), with a mobile fallback trigger beside search.
- The column-visibility menu controls which table headers/cells are shown (for toggleable table columns).
- Contact rows include both:
  - workflow status (`salesforce_status`, including inbound states)
  - Salesforce sync status (`salesforce_sync_status`)
- Contact details now prioritize recent activity over profile data:
  - the header is a minimal identity strip with compact actions
  - `Activity` is the primary sticky timeline/log region with dense separated rows
  - secondary metadata moved into a quieter collapsible `Details` section
- Contact details activity timeline now includes campaign enrollment events.
- Contacts row activation now follows playbook rules:
  - Enter/Space opens details from a focused row
  - row clicks ignore nested controls (`input`, `button`, links, and explicit row controls)
  - Escape closes details and focus returns to the last active row trigger
- Contacts now renders explicit data states in-place:
  - loading spinner
  - empty state
  - error state with retry action
- Contacts column visibility now keeps identity column `name` always visible.
- Contacts source labeling is now normalized in UI:
  - inbound Salesforce statuses (for example raw `inbound created`, shown as badge `Inbound New`) show source `Small Business Expo`
  - contacts with legacy inbound lead-source values (for example `website_form`) also show source `Small Business Expo` even after status transitions like `uploaded`
  - all other statuses show source `LinkedIn`

## Workspace Layout (Current Behavior)

- Workspace pages now share the Contacts-aligned shell spacing:
  - `pt-3 px-3 md:pt-4 md:px-6 pb-3 md:pb-6`
- This uniform wrapper is applied across Dashboard, Email, Documents, Templates, Tasks, Workflows, and Admin for consistent width and padding.
- Global UI base styles no longer apply fixed height/padding/size classes to all `<button>` elements; button sizing is now component-scoped to avoid icon-button collapse in table action columns.
- Table row density is now standardized to a 42px body-row target across core data tables (Contacts, Companies, Documents, Email Campaigns tablet rows) to keep visual rhythm and scan speed consistent between pages.
- Contacts desktop virtualized rows now use explicit `42px` row/cell height with collapsed table borders plus row measurement to prevent post-first-row height drift.

## Documents (Current Behavior)

- Documents page now follows the Contacts table + details pattern:
  - top toolbar with search input
  - type and status filters in the toolbar
  - table-first primary content area
  - right-side details pane as a real split-pane sibling on desktop only when a document row is explicitly selected (no default auto-open on initial load)
  - mobile document details in a bottom drawer
- Documents filters/columns trigger is pinned to the right edge of the table header row for consistent table controls.
- The left collection rail is removed; collection views are now selected from the toolbar filter menu.
- Documents table supports nested folder/file presentation from `storage_path` with collapsible folder rows.
- Documents header and body rows now share one deterministic grid column definition (NAME flexible, TYPE/STATUS fixed), so columns stay aligned when the right-side inspector is open.
- Documents table row density now matches Contacts row height using compact fixed-height rows and single-line name cells.
- Column visibility is configurable from the toolbar menu for the document table.
- Tree depth indentation is applied only inside the NAME cell content, preventing TYPE/COMPANY/STATUS drift on nested rows.
- Documents row interaction now matches Contacts conventions:
  - Escape closes details panel on desktop
  - focus returns to the last active row after closing details
  - row click and keyboard open behavior ignore nested controls
- Folder structure is now user-managed and persisted:
  - create folders inline from the table (immediate in-row rename/edit input)
  - move folders
  - move files between folders
  - delete empty folders
- Documents table supports drag-and-drop movement (folder-to-folder, file-to-folder, drop to root) for OS-style organization workflows.

## Email Campaigns (Current Behavior)

- Campaigns table now uses the same compact header/row sizing pattern as Contacts (`h-9` header, tighter `px-3 py-2` cells) for visual consistency.
- Campaigns toolbar now matches Contacts table controls:
  - no outer select-all/count control
  - search input
- Campaigns column-visibility trigger is pinned in the rightmost table header cell, aligned with the contacts/documents pattern.
- Campaign column visibility menu controls which table columns are shown.
- Campaign deletion is available both per-row and as bulk delete for selected campaigns from the campaigns table.
- Campaigns list now renders responsively by breakpoint to avoid horizontal page overflow:
  - desktop (`>=1024`): full table with sticky header and full action strip
- Campaigns table headers now enforce fixed one-line labels with truncation (`h-9`), so long labels (for example `Pending Review`) no longer increase header row height at narrower widths.
  - tablet (`640-1023`): compact row grid with key columns and overflow actions menu
  - mobile (`<640`): stacked campaign cards with status, compact metrics, and overflow actions menu
- Email page header is explicitly responsive:
  - desktop (`lg+`): single-row title/meta, tab rail inline to the right of title, actions on the far right.
  - tablet/mobile (`<lg`): two-row layout with title/actions on top and non-wrapping horizontally scrollable tabs below.
  - mobile (`<sm`): compact icon-only new-campaign action.
- Scheduled sending now supports a manual Salesforce review mode:
  - `POST /api/emails/process-scheduled?review_mode=true` launches headed browser tabs (one per due approved email), opens each composer, and leaves Send unclicked for manual approve/deny.
  - Email Scheduled view includes `Review in Tabs` to trigger that flow directly.
- Campaign sender `review_mode` no longer auto-clicks Send; it now verifies composer readiness only and leaves final send decision to the user.
- Email campaign template editing now uses the same pane system as contact details:
  - desktop: shared right-side `SidePanelContainer`
  - mobile: shared `BottomDrawerContainer`
  - editor content extracted into a reusable `CampaignTemplateEditorPane` component.
- Email review/history/scheduled details and campaign details panels now follow the Contacts inspector visual pattern more closely:
  - compact sticky top action strip
  - title/meta plus status chips directly beneath
  - primary content first in the main scroll region
  - quieter metadata moved into a collapsible `Details` section

## Templates (Current Behavior)

- Templates list pane now allows horizontal table scrolling when the side editor is open, preventing column compression.
- Template editor action controls are non-shrinking and horizontally scrollable, preventing tiny/collapsed buttons in narrow side-panel widths.

## Outlook Inbound Leads (Current Behavior)

- Outlook monitor parses inbound notifications from:
  - `clientservices@theshowproducers.com`
- Parsed leads are upserted to `linkedin_contacts` and recorded in `inbound_lead_events`.
- Newly ingested inbound leads auto-enroll into the `Small Business Expo` campaign when a matching campaign exists.
- Inbound contacts use `salesforce_status` values like:
  - `inbound created`
  - `inbound mapped`
- Poll status is persisted and exposed via:
  - `GET /api/emails/outlook/poll-status`

## Salesforce Sync for Inbound Leads (Current Behavior)

- Inbound sync uses single-contact create jobs in queue worker (`lookup_queue.py`).
- Queue statuses are tracked in `linkedin_contacts.salesforce_sync_status`:
  - `queued`, `creating`, `success`, `failed_*`
- Outlook poller enqueue rules treat `queued` as enqueue-eligible (not terminal) so
  DB pre-marked rows are still pushed into the in-memory worker queue.
- Existing inbound contacts can be backfilled and queued via:
  - `POST /api/emails/outlook/inbound-leads/queue-salesforce?limit=<n>`
- Campaigns can now backfill "already sent in Salesforce" activity before sending:
  - `POST /api/emails/campaigns/{campaign_id}/sync-salesforce-history?limit=<n>`
  - This scans lead activity timeline rows (for example "You sent an email to ...")
    and seeds `sent_emails` + campaign step state so previously-emailed contacts
    are not re-sent as brand new.
- Startup now includes inbound backfill queue pass when Salesforce sync is enabled.
- Worker rehydrates in-memory queue from DB rows already marked `queued`, so restart-safe processing works.
- Salesforce queue worker now performs periodic in-process DB rehydrate (every ~30s) for `queued` inbound rows, reducing risk of stuck queued contacts when in-memory enqueue is missed.
- Salesforce create jobs now surface in Tasks via workflow task manager (`operation=salesforce_create`).
- Queue worker now clears stale active browser-page locks (closed page references) and forces navigation to Salesforce login when a blank tab is detected, preventing stuck `SF queued` jobs with empty address bar.
- Lead create now supports direct URL mode (`SALESFORCE_NEW_LEAD_URL`) and pre-fills standard lead fields via `defaultFieldValues`, reducing brittle UI field typing failures.
- In direct URL mode, pre-create global search duplicate-check is skipped entirely, so automation no longer types name/email into global search before opening the new lead URL.
- Direct URL mode now supports required custom defaults via `SALESFORCE_DEFAULT_FIELD_VALUES` (semicolon-separated `FieldApiName=value` pairs), e.g. `Lead_Country__c=United States;Inbound_Outbound__c=Outbound`.
- Inbound queue create now passes `phone` into Salesforce lead create flow.
- Inbound queue create now maps Salesforce Lead Source to `Small Business Expo` and builds description text from the original inbound email categories (`title`, `industry`, `company`, `sender`).
- Inbound backfill now re-queues stale `creating` records (not just `queued`) so partially processed batches continue after interruptions.
- Lead URL normalization now resolves Salesforce `/lightning/o/Lead/new?...backgroundContext=...` URLs to the underlying lead record URL before persisting `salesforce_url`.
- Queue worker now performs a post-create URL resolution pass from the live Salesforce page state and persists the resolved lead-record URL to `linkedin_contacts.salesforce_url`.
- Lead save flow now clicks the top-right Salesforce modal close button (`Cancel and close`) when present after save, so URL context updates and created lead URL can be captured reliably.
- The queue now builds direct Salesforce `one.app#<base64>` Lead-search URLs from term-only payloads (no global-search typing), opens those URL-driven search pages, resolves Lead record links from results, and persists the matched `/lightning/r/Lead/...` URL.
- Lead URL detection/normalization now also accepts Salesforce table links in ID form (`/lightning/r/00Q.../view`), so record URLs from search-result rows are persisted correctly.
- Inbound Salesforce backfill now queues lookup-only URL resolution for rows with `salesforce_sync_status='success'` but empty `salesforce_url`, avoiding duplicate lead creation while repairing missing URLs.
- Contacts details panels now display a dedicated Salesforce link row, and "Open full details" prioritizes `salesforce_url` over LinkedIn when both exist.
- Salesforce inbound queue latency tuned:
  - Browser-busy gate now polls faster and caps at ~20s (was effectively much longer in practice).
  - Inbound create jobs preempt stale busy state after ~3s to start processing quickly.
  - Direct URL lead-create path uses shorter settle waits before save/URL capture.
- Lead URL validation hardened to avoid false positives on object/list pages (`/lightning/o/Lead/...` such as pipelineInspection). Only record-like Lead URLs (including `00Q` record routes) are treated as sync success.
- Lead save flow now waits briefly for post-save URL stabilization before and after modal close to reduce premature close/capture races.
- In URL-mode Salesforce sync, lead URL recovery/lookup now uses direct `one.app#<base64>` search URL navigation only; global search bar typing fallback is disabled.
- Lead create now checks Salesforce duplicate-warning UI (`force-dedupe-content` / "This record looks like an existing record") before/after save click; when detected, queue marks contact `salesforce_sync_status='skipped_duplicate'` and does not create another Lead.
- Inbound Salesforce create queue now has two pre-create duplicate gates:
  - local DB reuse: if another contact row already has a `salesforce_url` for the same email (or same name+company), the URL is reused and create is skipped.
  - live Salesforce lookup reuse: the queue searches Salesforce by email/name/company and reuses an existing Lead URL when found, before calling create.
- Template/contact variable sourcing for inbox-ingested leads (Small Business Expo):
  - `industry` now prefers latest `inbound_lead_events.lead_industry` and falls back to `targets.vertical`.
  - `location` continues to use `linkedin_contacts.location`, and Outlook inbound parser now captures `Location:` when present and upserts it onto the contact.
- Outlook inbound lead ingestion now attempts to open the `preview-lead=...&autologin=...` details URL from the email body, parse form fields (name, company, title, industry, email, phone, city/state/zip), and use those values to enrich contact upsert + inbound event storage.
- `inbound_lead_events` now includes `lead_location` for richer audit/debug data from inbox-ingested lead detail pages.

## Salesforce Auth (Current Behavior)

- Re-auth flow supports Salesforce MFA variant screens by:
  - clicking `Use a Different Verification Method`
  - selecting `Approve using Salesforce Authenticator` (`sem3` / `sem=3`)
  - clicking `Continue` (`save` submit button) after method selection
- Auth lifecycle emits browser automation and auth events used by UI/task monitoring.
- Session reuse is no longer force-expired by a fixed 24h heuristic:
  - `SALESFORCE_SESSION_MAX_AGE_HOURS` controls optional age expiry,
  - set `0` (default) to disable age-based expiry and reuse stored session as long as possible.
- Inbound Salesforce create duplicate-check ordering now uses existing columns only
  (`scraped_at` / `salesforce_uploaded_at`), preventing `salesforce_queue_exception`
  failures caused by missing `linkedin_contacts.created_at` in legacy DB schemas.

## Launcher / Browser Gateway (Current Behavior)

- `BROWSER_GATEWAY_MODE=camoufox` is treated as no-bridge-required mode.
- Launcher preflight/startup skips LeadPilot Node bridge checks/start when mode is not `leadpilot/openclaw`.
- Bridge script has a gateway-mode guard and skips cleanly when not required.

## Operational Flags

- `LEADFORGE_ENABLE=1`
- `LEADFORGE_SALESFORCE_ENABLED=1` (required for inbound Salesforce queue worker behavior)
- `BROWSER_GATEWAY_MODE=camoufox`
- `SALESFORCE_SESSION_MAX_AGE_HOURS=0` (disable forced session age expiry)
- `SALESFORCE_NEW_LEAD_URL=<org-specific lightning/o/Lead/new...>` (optional direct create flow)
- `SALESFORCE_DEFAULT_FIELD_VALUES=<FieldA=ValueA;FieldB=ValueB>` (optional required/custom prefill defaults)

## Contacts Inspector UI

- Refactored the contact right-side inspector into a compact layout:
  - sticky header with inline status/source chips
  - single-row compact actions (`Add to campaign`, overflow)
  - compact key/value quick facts list with copy/mail/call affordances
- Added an `Activities` timeline section at the bottom of the inspector:
  - currently populated from `/api/emails/conversations/{contact_id}/thread`
  - includes typed fallback timeline items and an empty-state CTA
  - includes TODO wiring note for a future unified contact-activities API payload

## Next.js Route Hygiene

- Moved dashboard helper modules out of `ui/src/pages/dashboard/*` into
  `ui/src/components/dashboard/page/*` and updated `ui/src/pages/Dashboard.tsx`
  imports so only real page modules remain under `src/pages`.
- This prevents Next.js page-config validation errors for non-route helper files.
- Next.js navigation hooks are now null-safe across shell/chat route state (`usePathname`/`useSearchParams` fallbacks in workspace shell, page context, and action executor), preventing startup/runtime crashes and strict type-check failures when Next returns nullable values.
- Contact table column definitions now explicitly use a unified TanStack `ColumnDef<Contact, any>[]` array to support mixed accessor-key and accessor-function columns (including the computed `lead_source` column) without Next.js TypeScript build failures.
- Page-level query parsing is now null-safe for Next `useSearchParams()` across Companies, Contacts, Documents, Email, and Templates pages by using fallback `URLSearchParams('')`/optional access, preventing recurring `searchParams is possibly 'null'` build failures.

## Campaign Progress Reconcile

- Added `POST /api/emails/campaigns/{campaign_id}/reconcile-progress` to recompute each enrolled contact's campaign progression from existing sent/reply history.
- Reconcile now cancels stale/pending drafts for already-replied/completed contacts, and `update_email_tracking(..., replied=True)` also pauses the corresponding campaign contact (`status='replied'`, `next_email_at=NULL`) to prevent step 3 from sending after a reply.
- Contact conversation thread now falls back from `rendered_subject/body` to `subject/body`, preventing sent items from rendering as `Email sent: No subject` when rendered fields are empty.
- Salesforce timeline history seeding now ignores task-style timeline entries (for example "Details for Task / Follow Up / You have an upcoming task") so non-email tasks are not seeded as sent emails.
- Contact details activity timeline now deduplicates merged entries from `/emails/sent` and `/emails/conversations/{contact_id}/thread` by `(type, timestamp, campaign, subject)` and keeps the richer status item (replied/opened/sent priority), preventing duplicate "Email sent" rows for the same event.
- Sent email records now persist Salesforce `EmailMessage` links (`sf_email_url`) captured from lead timeline `a.subjectLink`.
- For campaign steps after the first, sender flow now prefers navigating to the prior `sf_email_url` and clicking `Reply` on the EmailMessage record, then fills follow-up content in the reply composer. If reply navigation fails, it falls back to lead-level `Send Email`.
- Campaign sender review mode now truly prepares tabs for manual send (`skip_click=True`) instead of auto-sending when launched with `--review`, aligning campaign mode behavior with scheduled-review sessions.
- Fixed `email_sender_runner` module-path bootstrapping to add repository root (not `.../services`) to `sys.path`, preventing stdlib `email` shadowing (`ModuleNotFoundError: No module named 'email.message'`) during runner startup.
- Hardened Salesforce `EmailComposer.open_email_composer()` for Lightning variability: it now checks if composer is already open, tries multiple direct `Email` action selectors, then overflow `Show more actions` menu, then timeline action fallbacks before failing.
- Reply-composer fill now preserves conversation order by placing generated body first and appending the existing quoted/original thread at the very bottom when reply-thread markers are detected (`Original Message`, `From:`, `Sent:`, etc.).
- Added explicit Salesforce CKEditor iframe reply handling (`iframe.cke_wysiwyg_frame` / `iframe[title*='Email Body']`): automation now captures existing iframe body text, writes the generated template first, and re-appends original thread content beneath it.
- Composer interaction order updated: after composer opens (lead email action or EmailMessage reply), automation now clicks `Maximize` first, then proceeds with template selection and body fill.
- Reply flow now snapshots current CKEditor/reply body HTML **before** template insertion, inserts `Footer`, then fills generated template content above footer and appends the snapshotted original thread HTML at the very end.
- Added focused debug utility `scripts/reply_compose_probe.py` to test one EmailMessage reply page end-to-end (capture body -> clear/cut -> insert template -> fill above footer -> append original) without running full campaign batches.
- Campaign sender now performs a pre-run backfill for missing `sent_emails.sf_email_url` values by visiting each lead with prior sent history and collecting timeline `EmailMessage` links; this enables step-2+ flows to navigate directly to prior email URLs and click `Reply`.
- Step-2+ send behavior is now strict about direct reply flow when prior email URL exists: it attempts `EmailMessage -> Reply` first (with on-the-fly URL recovery from lead timeline if needed) and no longer silently falls back to lead-level compose for those contacts.
- CKEditor iframe focus was hardened for reply pages: automation now clicks a visible `iframe.cke_wysiwyg_frame`/`iframe[title*='Email Body']`, enters its `content_frame()` body, and only then runs select-all/delete behavior. Frame discovery now prefers visible/non-empty editor iframes instead of returning the first empty match.
- Added a short composer settle delay before clicking `Insert template` to reduce Lightning toolbar race conditions right after maximize/reply-body preparation.
- Reply-body merge now preserves inserted footer/template content already present in the editor: final compose order is generated body, then current editor HTML (for example Footer), then preserved original thread (if captured and not already present).
- Salesforce sender startup no longer uses fixed 5s+5s sleeps on initial Lightning navigation; it now uses a short `networkidle` settle and proceeds immediately when session is already authenticated.
- Reply-compose HTML merge now trims trailing/leading break markup around inserted template and footer/original boundaries to prevent excessive blank lines (notably between `Best,` and signature block).
- Reply-compose spacing normalization now runs on per-fragment DOM containers (template/footer/original) before merge, stripping leading/trailing blank nodes without deleting real signature content.
- Reply-compose section joiner now uses a single `<br>` boundary (not `<br><br>`) to avoid extra visible blank space between generated template, footer, and appended original message content.
- Reply flow now captures the existing subject before template insertion and restores it during final fill, preventing Footer/template actions from overwriting the thread subject line.
- Campaign template variable support expanded for contact name parts: `{firstName}` / `{lastName}` (plus `{first_name}` / `{last_name}` and legacy `{FirstName}` / `{LastName}`) now render in generator and fallback paths; template editor UI now advertises these tokens.
- Added utility script `scripts/reconcile_manual_review_sends.py` to backfill manual Salesforce sends (from headed review tabs) into `sent_emails` with `sf_email_url` and advance `campaign_contacts.current_step`/status so contact-details activity timelines stay accurate after manual send sessions.
- Contact details Activities pane now includes a minimal status filter (default `Non-failed`) so failed events do not surface immediately; users can switch to `All`/`Failed`/specific statuses as needed.
- Contact details Activities now default to `All` and present a clearer plan+execution timeline: sent rows are consolidated by campaign step (reducing duplicate failure cards), failures surface as red status on the corresponding activity, and active enrollments show upcoming scheduled activity from `next_email_at`.
- Contact details activity status pills use colored borders plus matching background/text to keep statuses clear at a glance.
- Contact details timestamps now render in `America/New_York` with explicit zone suffix (`EST`/`EDT`) for consistent activity timeline times.
- Contact details timestamp parsing now treats timezone-naive backend datetime strings as UTC before rendering in ET, preventing future-time shifts (for example sent rows showing several hours ahead).
- Contact details Campaigns summary now shows Small Business Expo enrollment status, active/total counts, and a single link to the active campaign for quick navigation to Email campaigns.
- Email campaigns table rows now use the shared 31px table row height token so they match the Contacts table row density.
- Email campaigns table custom grid layout now renders the same vertical column separators as the shared desktop tables, so headers and rows read consistently across Email views.
- Email campaigns now uses the same shared desktop table implementation as Review/Scheduled/History (with a campaigns-specific column menu control), removing the previous custom desktop/tablet table path that drifted in separators and header/body behavior.
- Email Review desktop rows now flatten Contact, Campaign, and Draft cells to single-line summaries so the shared 31px row height does not read as oversized/double-height.
- Contacts API now returns a derived `engagement_status` (campaign/activity state) per contact using replies, latest send status, campaign enrollment, and upcoming schedule signals.
- Contacts UI now uses `engagement_status` as the primary status badge/filter (table, mobile cards, detail panes), while raw Salesforce status remains visible as secondary CRM context.
- Contact details pane now falls back to timeline-derived engagement status when `engagement_status` is missing/stale from the contacts payload, preventing misleading `Pending` labels when sent/scheduled activities already exist.
- Contact detail views now show a single primary status (`engagement_status`) and no longer render a separate `CRM Status` row to reduce conflicting signals during outreach operations.
- Contacts table now suppresses `SF success` sync pills; only actionable Salesforce sync states (queued/creating/failed) are shown next to engagement status.
- Unified contact lifecycle status now uses `needs_sync` as the pre-Salesforce state (replacing `inbound_new`/`pending`) so table and details show one operational status taxonomy.
- Hardened Salesforce duplicate-suppression lookup: pre-create search now requires preferred-name match and no longer falls back to first arbitrary search result, preventing wrong lead URL attachment between contacts.
- Removed company-name fallback from pre-create Salesforce duplicate lookup; matching now uses email and full-name only to avoid broad-result misattachment.
- Tightened pre-create Salesforce duplicate suppression further: remote reuse now only matches by deterministic identity keys (`email` and `phone`) and no longer reuses records from name-only matches, preventing false positives on common names (for example same-name different person/company).
- Name normalization now preserves numeric characters in contact names (for example `Gr3g`) instead of stripping them during ingestion-time classification.
- Salesforce one.app search-context URL recovery now disables "first-result" fallback whenever a preferred contact name is provided, preventing wrong lead attachment during URL reconstruction when search results are ambiguous.
- Fixed Documents drag/drop move bubbling: folder-level drops now stop propagation and root drop only handles direct root drops, preventing accidental "move to root" overrides that looked like no-op moves.
- Sidebar navigation no longer shows a standalone Templates item; templates are now accessed from the Email tab row via a Templates sub-tab link, and `/templates` highlights under Email in nav state.
- Added shared page search input component and wired it across Contacts, Documents, Templates, Email, and Tasks so search appears in a consistent toolbar position when switching pages.
- Standardized table placement and header density across Contacts, Documents, Templates, Email Campaigns, and Tasks: table regions now start with a consistent `mt-2` gap below toolbar search and table header rows use the same 36px (`h-9`) style with 11px uppercase labels.
- Replaced Email segmented navigation with browser-style tabs (Campaigns, Templates, Review, Scheduled, Sent History) in a dedicated tab bar above the search row to improve visual hierarchy and support future closeable-tab behavior.
- Templates page now uses the shared `EmailTabs` component in the same pre-header slot as Email so tab visuals and positioning remain consistent when switching between Campaigns and Templates.
- Browser Workbench now uses the same shared tab pattern for top-level browser flow selection, while preserving the existing in-page browser tab manager as a second tab layer for live tabs opened within each flow. Helper actions on the same page no longer create new outer tabs; same-tab flow tabs are only created from meaningful page/flow transitions, and final flow groups own contiguous live browser tabs until the next anchored flow.
- Tool-planner normalization now rewrites raw Sales Navigator browser loops back to `browser_search_and_extract` when a SalesNav turn falls into low-level `browser_navigate`/`browser_act` steps without choosing the mapped workflow tool, forcing the backend URL-builder path for standard SalesNav searches.
- SalesNav browser-tool selection now preserves `[BROWSER_SESSION]` context during planner tool gating, so implicit employee-at-company lookups on an already-open LinkedIn Sales Navigator tab can still select browser/SalesNav workflow tools instead of collapsing to local `hybrid_search`.
- SalesNav company-identity presearch now uses a fast path in company result scraping when only a handful of rows are needed (for example resolving `current_company` before a people search), avoiding the full 20-scroll company extraction loop that made exact-company prepasses feel stuck on `/sales/search/company`.
- SalesNav URL-builder fallback no longer hard-fails on simple keyword/name-only queries when NL decomposition is unavailable; short plain queries like `Zco Corporation` now pass straight to the URL builder, while natural-language constraint queries still fail closed unless decomposed or structurally filtered.
- SalesNav employee listing now applies that same exact-company fallback inside `browser_list_sub_items` parent resolution, so `salesnav_list_employees` can resolve a company SalesNav URL from a plain company name without failing on decomposition before the employee flow starts.
- SalesNav employee listing now also has a deterministic account-results fallback: when `salesnav_list_employees` lands on `/sales/search/company`, it can open the matched company row's `employees on LinkedIn` link directly instead of depending solely on the learned `employee_entrypoint` action.
- Browser `salesnav_list_employees` now reuses the existing Sales Navigator public-profile enrichment flow on the live people-results page, so employee listing can click into profiles / copy public LinkedIn URLs before returning rows instead of stopping at shallow lead cards.
- `salesnav_list_employees` now always classifies as a long-running browser workflow because the deeper public-profile enrichment can continue well after the initial people-results page loads; this avoids sync-response 500s while the browser is still correctly working through profile URL extraction.
- Chat dispatch summaries now surface extracted rows for browser workflow tools like `browser_list_sub_items` instead of collapsing successful item-returning runs to generic `Executed ...` status text, so SalesNav contact lookups return visible contact data in the assistant reply.
- Browser-extracted SalesNav people rows now normalize into the existing contact result shape (`title`, `company_name`, `email`, `phone`, `linkedin_url`) and render through chat contact cards with a follow-up prompt asking whether to create them as contacts.
- Tasks workspace now sanitizes compound-workflow metadata before rendering: internal planner prompts in workflow `name`, `description`, or `original_query` are hidden/collapsed in favor of human phase labels so the details panel shows meaningful workflow context instead of raw ReAct/system prompt payloads.
- Tasks workspace now sorts unified browser + compound rows by most recent heartbeat/update time so newly launched tasks surface at the top instead of being buried below older compound entries.
- Tasks workspace now hides low-level `browser_automation` primitives (`browser_act`, `browser_wait`, `browser_navigate`, etc.) from the main `/tasks` table so the page stays focused on workflow-level browser tasks instead of listing every underlying action as a separate row.
- Tasks workspace now enforces the stronger policy that `/tasks` only shows long-running background browser jobs (`browser_workflow_async`) plus compound workflows; short synchronous browser workflows are excluded from the table entirely.
- Tasks workspace now uses the same shared Airtable-like resizable table foundation as Contacts/Documents/Email on desktop, with explicit column definitions, subtle vertical dividers, header-only resize handles, double-click auto-fit, and persisted widths under `tasks-table`.
- Browser task result cards in the Tasks details panel now render as compact contact-style summaries with linked names and short action links (`LinkedIn`, `SalesNav`, `Source`) instead of printing full raw URLs inside each card.
- SalesNav public-profile enrichment now preserves direct public profile URLs when `View profile` opens an actual `linkedin.com/in/...` page, and the batch enrichment path writes that captured public URL back onto each employee row immediately so Tasks/browser results do not collapse both links to the SalesNav lead URL.
- SalesNav public-profile copying now retries clipboard reads after the `Copy LinkedIn URL` action, re-checks the page HTML after copy, and the Tasks browser-result summary shows how many public profile URLs were actually captured so extraction failures are visible immediately.
- Tasks now uses the same top-tab workspace shell pattern as Contacts, Documents, Email, and Browser Workbench, with route-backed `All Tasks`, `Browser`, and `Compound` tabs plus the same 42px desktop row height and cell density as the other table pages.
- SalesNav public-profile extraction now routes overflow/menu/copy clicks through the shared interaction helpers (`scroll_into_view`, pointer click, jittered settle) instead of raw direct clicks, preventing off-screen and pre-load clicks during the lead-profile copy flow.
- Planner fast-path now pauses vague SalesNav employee-detail requests to ask a clarification question for missing count/detail fields, and SalesNav lead-profile public URL copying opens lead pages in separate tabs so the main search/results tab stays open during enrichment.
- SalesNav clarification follow-ups now persist as an active task with required params (`contact_count`, `detail_fields`), so replies like `10 and all the details` resume the original SalesNav request instead of being routed as a fresh standalone `hybrid_search`.
- SalesNav clarification resume no longer appends raw `Parameters: {...}` JSON into the search text; the active-task confirmation path reconstructs a clean structured request sentence from the collected params so SalesNav account search URLs only contain the company name.
- Campaigns table Send action now launches review-mode prep for all ready contacts in that campaign (high limit), matching manual backend review-tab launches from `/api/emails/send` with `review_mode=true`.
- Review queue API no longer hard-caps results to 50 rows; `/api/emails/review-queue` now returns the full `ready_for_review` set by default so the Email review table reflects all pending drafts.
- Shared medium-width table viewport fitting now pins a leading selector column together with the first visible data column, preventing Email review/campaign tables from showing an empty standalone checkbox column when the details panel is open.
- Email Campaigns now includes a contact-style campaign details rail (desktop side panel, phone drawer) with high-level campaign metadata and one unified scrollable Contacts manager that combines add/remove actions in a single fixed-height section.
- Browser Workbench no longer renders the separate `Browser Workbench / Flow: ...` header block above the canvas; the small circular refresh control now lives in the top flow-tab row so the workbench matches the other tab-first pages more closely.
- Browser Workbench also no longer uses the dedicated left-side `Tab Manager` rail in the main layout; flow tabs now sit on the first row, open browser tabs render as a second nested tab row, and tab search moved into the standard inline toolbar position directly below the tabs.
- Browser Workbench now treats `Browser Tabs` as the first top-level tab: it renders a contact-style table of open browser tabs with a right-side details panel for browser-oriented metadata and linked workflow/task hops, while the remaining top-level tabs represent high-level running tasks and continue to show the live browser imagery for the nested browser tabs tied to that task.
- Table-first workspace pages now use the same wide, flush presentation as the Browser page: removed the extra rounded outer border shell around the main table regions in Contacts, Companies, Documents, Templates, Email, Tasks, and Campaign tables so tables span the workspace width more cleanly while keeping their existing split details panels.
- Workspace page padding is now tightened to the Browser layout baseline (`px-3 md:px-4` with `pb-3 md:pb-4`) in the shared page shell and custom table pages, so the wider table treatment stays consistent instead of snapping back to older `md:px-6` gutters.
- Remaining custom page wrappers that bypass the shared shell now use the same tighter horizontal gutter too (`Companies`, `Admin`, `Dashboard`, and `Workflows`), removing the old double-inset effect where two nested `px-3`/`md:px-6` layers made non-browser pages feel narrower than the Browser table layout.
- The shared `WorkspacePageShell` content region no longer adds its own horizontal `px-*` gutter; header/toolbars still align on `px-3 md:px-4`, but the main content area is now flush so table pages do not get doubly inset before their normal cell padding.
- The shared `WorkspacePageShell` header wrapper is also now flush horizontally: top search/tool rows and tab preheaders no longer sit inside a second `px-3 md:px-4` gutter, so the toolbar width matches the table region below instead of appearing narrower.
- The chat dock session header is now split into two visual groups: session tabs plus `+` on the left, and muted panel controls on the right (`Trace`, divider, minimize, collapse). The collapse control is icon-only with a rotate animation so it reads as a dock/panel affordance rather than another session action.
- Contacts now serves as the source-of-truth workspace pattern for the other major table pages: Documents, Email, Templates, and Tasks use the same tab rail treatment, tighter search/action row spacing, square control styling, flush content layout, and shared desktop table row/header height.
- The leading blank selection column pattern from Contacts is now shared across the other major workspace tables instead of embedding selection controls inside the first data column.
- Shared medium-width table fitting now supports a pinned trailing `actions` column in addition to the leading `select` column, so Contacts can keep its row ellipsis visible on the right edge while the center columns rotate under narrower widths.
- Contacts desktop details now uses a draggable split view: users can resize the right-side details/add panel from a left-edge divider, the table shrinks/grows with that drag, and the chosen width persists locally for future opens.
- Contacts row-level actions now live in a compact right-side ellipsis column (`Add to campaign`, `Open full details`, `Delete`), while the leftmost control column remains dedicated to row selection; this replaces the old `Add to campaign` / `Open full details` buttons in the contact details header.
- Contacts detail-pane top action strip is removed; contact `Email` and `Phone` actions now live in the row ellipsis menu alongside `Add to campaign`, `Open full details`, and `Delete`, leaving the page-level search/new-contact row as the primary visible action strip.
- Contacts search/new-contact row now sits above the entire table/details split instead of inside the left table pane, so it spans across the details rail and sits directly above the contact activity area when a details pane is open.
- Contacts right-side actions column is now tightened to the small ellipsis trigger width and explicitly allows overflow, so the dropdown menu can escape the table cell instead of being clipped behind adjacent cells.
- Contacts right-side actions column uses a compact fixed utility width again, decoupled from the wider `Columns + arrows` header overlay so the row ellipsis does not regress into an oversized gutter.
- Contacts right-side actions column remains fixed at `56px`, matching the effective width of the right-edge header controls block closely enough that the row ellipsis column aligns under that utility header region without consuming a full extra data-column slot.
- Contacts right-side actions column is also now rendered as a sticky right-edge utility column in both header and body, so the ellipsis stays pinned during resize instead of being pushed off-screen and snapping back after the drag settles.
- Contacts desktop rows no longer render a separate empty body spacer cell immediately before the sticky ellipsis column; the resize boundary now lines up with the real actions cell instead of a blank placeholder slot.
- Shared fitted-table colgroups/headers now omit the separate filler reservation entirely when a pinned trailing `actions` column is present, so Contacts no longer carries a hidden gutter immediately before the ellipsis column.
- Contacts body rows likewise omit the filler `<td>` when that pinned actions column is present, keeping the ellipsis hard against the right-side utility edge instead of leaving a blank spacer before it.
- In that no-filler pinned-actions path, the shared fitter also no longer leaves spare width in the table-width calculation itself; this prevents the browser from redistributing extra space across real columns and keeps earlier dividers visually fixed while the last visible Contacts column is resized.
- Contacts body rows no longer render a visible filler cell when the sticky ellipsis/actions cell is present; the right-edge gutter is carried by the fixed actions column itself so the body no longer shows a blank spacer column before the ellipsis.
- Contacts keeps the smaller right-edge viewport-control gutter for stable column-fit behavior, while the header controls overlay now uses extra left-side surface padding so the final divider sits visually behind the filter/arrow cluster without causing columns to disappear early.
- The shared right-edge `Columns + arrows` overlay now renders as one encapsulated surface block with an extra left-side cover strip, so underlying header dividers do not visually split the columns dropdown from the pager buttons.
- Shared fitted-table headers now render a dedicated full-height divider immediately before the right-edge `Columns + arrows` control block, giving Contacts a clear visual stop point for the last visible data column before the fixed utility edge.
- Contacts no longer uses the floating shared right-edge header overlay for `Columns + arrows`; those controls now render inside the actual sticky actions `<th>`, so the row ellipsis column and its header controls share the same fixed utility column.
- Fitted desktop tables still clamp the actively resized visible column itself against the remaining on-screen width, but no longer run a second pass that silently shrinks a different visible column; in Contacts this restores the expected behavior where resizing the last visible data column before the ellipsis only affects that column.
- Fitted desktop tables now preserve the logical trailing visible column when the number of visible slots changes during resize, so narrowing a Contacts column pulls the next pushed-off column back into view instead of drifting the ellipsis-side rotation state.
- Fitted desktop tables now also freeze the current visible scrolling-column set for the duration of an active resize gesture, so growing or shrinking a Contacts column no longer causes an earlier neighbor to be reassigned mid-drag.
- Shared persistent column sizing now hydrates stored widths once per storage key instead of reapplying them on every render cycle, preventing the `Maximum update depth exceeded` loop in Contacts and other shared tables.
- During an active fitted-table resize, only the column being dragged is clamped against the remaining visible width; the fitter no longer applies a special rotating-column clamp that could visually mutate a different neighbor.
- During an active fitted-table resize, the shared fitter now uses the exact last stable visible scrolling-column set and order, instead of recalculating offset/rotation state mid-drag; this keeps Contacts' visible columns stable while one column is being resized.
- During that same active resize, the shared fitter also preserves the last stable widths of the other visible scrolling columns, so growing a later Contacts column no longer recomputes or visually expands/shrinks earlier visible columns.
- The shared fitter now exits early into that locked-layout path for the full duration of an active resize gesture, instead of continuing through the normal fit/rotation pass; this keeps Contacts column visibility and neighbor widths stable until the drag ends.
- The shared fitter now applies the "last visible scrolling column stops before the ellipsis/actions boundary" clamp before it computes which columns fit, so ending a resize on the Contacts last visible data column no longer lets that oversized saved width push the previous column out of view.
- For fitted tables that already have a pinned trailing `actions` edge plus filler, the data-column fit budget no longer subtracts the separate viewport-controls gutter a second time; this moves the resize stop point back to the real ellipsis boundary instead of clamping a column prematurely.
- The non-drag fitted-layout clamp for the last visible scrolling column now only subtracts other scrolling-column widths from the scrolling budget, rather than subtracting the pinned selector/actions widths a second time; this keeps the last Contacts data column aligned to the fixed ellipsis edge correctly after resize settles.
- Fitted desktop tables with a pinned trailing `actions` column now absorb spare container width into the dedicated filler slot immediately before the actions column, keeping the row ellipsis aligned to the right edge without redistributing that extra width into visible data columns.
- Fitted desktop tables with a pinned trailing `actions` column no longer render a fake filler column at all; the table width is resolved without an empty trailing header/body cell, so Contacts' last real column does not get visually cut by a phantom spacer.
- The spacer immediately left of the pinned Contacts actions column now renders a divider, so the right-edge ellipsis reads as its own narrow column instead of blending into the filler space used by the fitted table viewport.
- Contacts toolbar now keeps `Search contacts` and `New Contact` together on a fixed primary row, while selected-row bulk actions wrap on a separate secondary row so opening the details panel no longer drops the main add action below the search field.
- Contacts now applies that hard resize stop only to the last visible data column before the fixed ellipsis edge. Other visible columns continue to resize normally, while the edge-adjacent column still cannot grow by stealing width from already-visible columns.
- Contacts desktop tables now stay on the fitter's native fixed-width table style instead of forcing `width: 100%`, which preserves stable column-resize behavior and prevents spare pane width from being redistributed into earlier visible columns.
- Fitted tables with a pinned trailing `actions` column now absorb spare pane width by extending the last visible data column before that fixed edge, instead of leaving a dead gap on the right or rendering a separate visible filler gutter column.
- Persistent column sizing now supports min-width initialization, and Contacts uses that mode with a fresh sizing key (`contacts-table-sizing-v2`) so desktop columns load from their minimum widths by default while auto-fit still restores measured content widths on demand.
- Contacts now exposes `Date Added` in the visible-columns menu as a sortable optional column backed by `scraped_at`, formatted as a compact date and hidden by default until enabled.
- Contacts row actions now render the open ellipsis menu in a fixed portal above the table stack, so the `Add to campaign` / `Email` / `Phone` dropdown is no longer clipped by sticky headers or neighboring table cells.
- Contacts no longer reserves right-side body padding for the custom vertical scroll thumb, so the scrollbar overlay no longer changes the effective table width when it appears.
- Contacts now centers the `Columns + arrows` control cluster inside the sticky actions header cell, so those controls align with the fixed right-edge ellipsis utility column instead of hugging the far right side of the header wrapper.
- Shared fitted-table headers no longer add an extra `pr-2` nudge inside the inner header flex wrapper, which lets utility-header content like the Contacts right-edge controls center cleanly inside their actual `<th>`.
- Contact details activity table now resets to a fresh sizing baseline (`contact-activity-table-v3`) with larger default/min widths for `Type`, `Date`, and `Status`, so those support columns open fully by default while only the main `Activity` column continues to truncate.
- Contact details activity sizing now force-fits the four activity columns as a set inside the details rail during pane resize, shrinking `Activity` first so `Status` does not get pushed off-screen when the details pane narrows.
- Email Sent History rows now use the same denser two-line compact-row treatment as the other table pages, collapsing extra campaign/company metadata and tightening the footer stats so constrained viewports no longer look oversized.

## Notes Removed

- Historical step-by-step freeze-debug timelines
- Duplicated migration logs and repeated change blocks
- One-off intermediate experiments no longer relevant to current runtime behavior
