---
summary: "Proposal for unifying the Assistant UI patterns into a single Assistant Panel System."
title: "Assistant Panel System Proposal"
---

# Assistant Panel System Proposal

## 1. Consolidated IA and Component Architecture

To resolve the fragmentation of assistant surfaces (bottom dock, right-side panel, chat-first shell), the application will move to a **Global Assistant Panel System** anchored in the App Shell. 

### Component Hierarchy

```
<AppShell>
  <MainContentArea />
  <GlobalAssistantPanel>
    {/* Primary conversational surface */}
    <ChatStream>
      <AssistantMessage />
      <UserBubble />
      <UnifiedCardSystem>
        {/* Replaces disparate action/workflow/status cards */}
        <StatusCard />
        <ResultCard />
        <ConfirmationCard />
        <ErrorCard />
      </UnifiedCardSystem>
    </ChatStream>
    
    <ChatInputArea />
  </GlobalAssistantPanel>
  
  {/* The secondary surface for deep dives */}
  <ContextPreviewDrawer />
</AppShell>
```

- **`GlobalAssistantPanel`**: The single, universal root component (likely a right-side collapsible panel or a persistent dock that expands identically across all routes).
- **`ContextPreviewDrawer`**: A secondary, highly controlled surface (e.g., an off-canvas drawer or a split pane) that *only* appears for complex graphical tasks, replacing the scattered "Live UI Previews".
- **`UnifiedCardSystem`**: A single component factory that standardizes padding, typography, icons, and button placement for all assistant states.

## 2. State Model for Assistant UI Modes

The Assistant UI will operate on a strict state machine to prevent visual noise:

1. **`idle`**: Ready for input. Minimal UI footprint.
2. **`planning`**: LLM is routing the intent or decomposing a task. Shows a subtle `ThinkingMetaCard` (e.g., "Analyzing request...").
3. **`awaiting_confirmation`**: A plan has been generated but requires user authorization. The chat stream halts, and a `ConfirmationCard` is presented.
4. **`executing`**: Tools are running. Displays a `WorkflowProgress` card with real-time status (e.g., "Fetching contacts 2/5").
5. **`showing_results`**: Execution complete. Displays text synthesis accompanied by a rich `ResultCard` (e.g., a mini contact profile).
6. **`error`**: Action failed. Displays an `ErrorCard` with a clear recovery action (e.g., "Retry" or "Edit parameters").

## 3. Trigger Rules for Contextual Preview vs. Chat

Currently, the Context Preview opens too aggressively. We will implement deterministic trigger rules based on the `actionExecutor`:

**Keep Interaction in Chat (Do NOT open Preview):**
- **Entity Lookups:** "Who is the CEO of Acme Corp?" (Return text + inline ResultCard).
- **List Filtering:** "Show me contacts in Healthcare." (Apply filter to the main UI route via `set_filter`, do not open a dedicated preview).
- **Status Checks:** "Did my campaign finish?" (Return text + inline StatusCard).
- **Single-step Safe Writes:** "Update John's phone number to X." (Update in background, confirm in chat).

**Open Context Preview:**
- **Drafting/Content Creation:** Creating an email sequence, writing a complex campaign where the user needs a full editor.
- **Bulk Data Review:** When a workflow requires manual triage (e.g., "Review these 50 scraped leads before saving").
- **Deep-Dive Entity Analysis:** If the user clicks "View Full Profile" from an inline `ResultCard` inside the chat.

## 4. Migration Plan

Transitioning from the mixed patterns to the unified system will occur in 4 phases:

**Phase 1: Card Unification (Low Risk)**
- Audit `ActionCard`, `WorkflowEventCard`, and `InlineConfirmRow`.
- Build the `UnifiedCardSystem` and refactor existing chat components to use it. This standardizes the visual language immediately.

**Phase 2: App Shell Integration (Medium Risk)**
- Introduce `GlobalAssistantPanel` to the main layout.
- Map global state to handle its visibility.

**Phase 3: Route-by-Route Migration (High Risk)**
- Deprecate `ChatDock` in standard routes (e.g., Dashboard).
- Deprecate `ChatPane` in specialized routes (e.g., Contacts).
- Route all assistant invocations through the `GlobalAssistantPanel`.

**Phase 4: Preview Engine Overhaul**
- Replace the aggressive "Chat-first shell with workspace preview" with the targeted `ContextPreviewDrawer` triggered strictly by the rules defined in Section 3.

## 5. UX Spec for Lookups vs. Write/Destructive Actions

**Read-only / Quick Lookups**
- **Flow:** User Input -> Planning (brief) -> Showing Results.
- **UI:** Stream text directly into chat. Append a rich entity card if a specific record is matched.
- **Rule:** Never ask for confirmation. Never open a context preview.

**Write / Safe Mutations**
- **Examples:** Updating a field, adding a tag, assigning an owner.
- **Flow:** User Input -> Executing -> Showing Results.
- **UI:** Show an inline "Executing..." loader, followed by a success card.
- **Rule:** Do not halt for confirmation if the user explicitly requested the change. Provide a localized "Undo" button on the success card if possible.

**Destructive / Bulk Actions**
- **Examples:** Deleting records, launching mass email campaigns, bulk-enrolling contacts.
- **Flow:** User Input -> Planning -> Awaiting Confirmation (HALT) -> Executing -> Showing Results.
- **UI:** Render a prominent `ConfirmationCard`. The card must explicitly state the blast radius (e.g., "This will email 450 contacts").
- **Rule:** Always halt and require an explicit "Confirm" click.

## 6. Recommended Interaction Patterns

- **Simple Entity Lookup:**
  User asks a question. Assistant responds with a paragraph of text, followed by an inline card containing key data points and deep-link buttons.
  
- **Filtered Search:**
  User asks to filter data. Assistant responds "Filtering by X" and emits a `set_filter` action. The main application viewport (e.g., the data table) updates instantly. No duplicate preview is shown.

- **Multi-step Workflow:**
  Assistant enters the `executing` state and renders a `WorkflowProgress` stepper card inline. As steps complete (e.g., "1. Searching SalesNav", "2. Extracting Employees"), the stepper updates visually without spamming new chat messages.

- **Confirmation-required Actions:**
  Assistant stops text generation and renders a high-contrast `ConfirmationCard` with "Confirm" and "Cancel" buttons. The UI is blocked from executing the tool until the user interacts.
  
- **Long-running Background Tasks:**
  For tasks taking >10 seconds, the assistant acknowledges the request ("Starting background job..."), renders a `TaskStartedCard`, and frees up the chat for new queries. A global progress indicator in the app header allows the user to monitor or cancel the task asynchronously.
