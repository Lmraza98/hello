# Chat Agent Phase 2 Documentation

This document captures the Phase 2 chat agent implementation so the architecture, intent flow, and extension points are not lost.

## What Phase 2 Adds

Phase 2 replaces the Phase 1 stub chat response logic with:

- A typed chat message model
- Keyword-based intent parsing
- A deterministic workflow engine (state-machine style)
- Workflow definitions by intent
- Dashboard section auto-expansion from workflow results
- API adapter methods (real mappings where possible + explicit stubs)

No LLM integration is included yet. That is planned for Phase 3.

## File Map

### Core Types

- `ui/src/types/chat.ts`
  - All `ChatMessage` union types
  - `ParsedIntent` and `IntentType`
  - `Workflow`, `WorkflowStep`, `StepResult`

### Intent + Engine

- `ui/src/services/intentParser.ts`
  - Keyword parser for user input
  - Produces `{ intent, entities, confidence, raw }`

- `ui/src/services/workflowEngine.ts`
  - Entry points:
    - `processMessage(message, activeWorkflow, dashboardData?)`
    - `processAction(actionValue, activeWorkflow)`
  - Internal state-machine execution:
    - `createWorkflow(...)`
    - `runWorkflow(workflow)`
    - `resumeWorkflow(workflow, userInput)`

### Workflow Helpers

- `ui/src/services/workflows/helpers.ts`
  - Message factory helpers:
    - `msgId()`
    - `textMsg(...)`
    - `statusMsg(...)`
    - `buttonsMsg(...)`

### Workflow Definitions

- `ui/src/services/workflows/statusCheck.ts`
- `ui/src/services/workflows/contactLookup.ts`
- `ui/src/services/workflows/contactOutreach.ts`
- `ui/src/services/workflows/campaignList.ts`
- `ui/src/services/workflows/conversationList.ts`
- `ui/src/services/workflows/help.ts`

### UI Integration

- `ui/src/hooks/useChat.ts`
  - Replaced Phase 1 timer-based stub
  - Tracks active workflow in `activeWorkflowRef`
  - Routes text and action clicks through workflow engine
  - Exposes:
    - `messages`
    - `isTyping`
    - `sendMessage`
    - `handleAction`
    - `cancelWorkflow`
    - `hasActiveWorkflow`

- `ui/src/components/chat/ChatMessage.tsx`
  - Supports rendering:
    - `text`
    - `status`
    - `action_buttons`
    - `contact_card`
    - `email_preview`
    - `campaign_list`
    - `conversation_card`

- `ui/src/components/chat/ChatContainer.tsx`
  - Uses shared `ChatMessage` type from `types/chat.ts`

- `ui/src/pages/Dashboard.tsx`
  - Passes dashboard data into `useChat(...)`
  - Wires `onExpandSection` so workflows can auto-open accordion sections

### API Adapters/Stubs

- `ui/src/api.ts`
  - Added chat-focused methods:
    - `searchContacts(...)`
    - `salesnavSearch(...)` (stub)
    - `createContact(...)`
    - `syncToSalesforce(...)` (stub)
    - `getCampaigns(...)`
    - `registerToCampaign(...)`
    - `generateEmail(...)` (stub)
    - `approveEmail(...)` (stub)
    - `discardEmail(...)` (stub)

## Runtime Flow

1. User sends text from chat input.
2. `useChat.sendMessage(...)` appends user message and calls `processMessage(...)`.
3. If a workflow is waiting for input, engine resumes it.
4. Otherwise, parser chooses an intent and engine creates a workflow.
5. Engine executes steps until:
   - workflow completes/fails, or
   - a step returns `waitForUser: true`.
6. Engine returns messages + optional `expandSection`.
7. `useChat` appends messages and expands matching dashboard section.
8. If user clicks an action button, `useChat.handleAction(...)` calls `processAction(...)`.

## Supported Intents in Phase 2

- `status_check`
- `contact_lookup`
- `contact_outreach`
- `campaign_list`
- `conversation_list`
- `help`
- `unknown` (fallback response)

## Workflow Notes

- `contact_lookup`
  - DB search
  - Optional Sales Navigator lookup
  - Optional contact creation
  - Optional Salesforce sync

- `contact_outreach`
  - Resolve contact (DB or Sales Nav)
  - Optional create contact
  - Campaign selection
  - Registration
  - Email generation
  - Approve/edit/discard handling

- `conversation_list`
  - Uses `recentReplies` passed from dashboard context
  - No extra fetch in this workflow

## Known Phase 2 Limitations

- No LLM parser/formatter yet (keyword matching only).
- Several API methods are stubs and intentionally throw `Not implemented`.
- Conversation card actions currently post action values back to engine; they are not wired to open the side panel or mark done directly from chat yet.
- In-chat campaign creation/editing is not implemented.

## How to Extend

### Add a new intent

1. Add intent literal to `IntentType` in `types/chat.ts`.
2. Add parse rule in `services/intentParser.ts`.
3. Create workflow file under `services/workflows/`.
4. Register it in `createWorkflow(...)` switch in `workflowEngine.ts`.

### Add a new message type

1. Extend `ChatMessage` union in `types/chat.ts`.
2. Render it in `components/chat/ChatMessage.tsx`.
3. Return it from workflow step `messages`.

### Replace parser with LLM (Phase 3 plan)

- Keep `parseIntent(...)` return shape stable (`ParsedIntent`).
- Swap internals with LLM request.
- Workflows and engine can remain unchanged.

## Testing Checklist

- `help` returns command summary
- `status`/`stats` shows dashboard summary and opens `metrics`
- `show conversations` renders conversation cards and opens `conversations`
- `list campaigns` renders campaign list
- `find Name at Company` enters contact lookup flow
- Action buttons resume workflows correctly
- Unknown inputs return fallback guidance

