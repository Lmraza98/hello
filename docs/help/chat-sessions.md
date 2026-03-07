---
summary: "Assistant dock chat-session tabs, isolation, and local persistence behavior."
read_when:
  - You are debugging assistant session resets or tab switching
  - You are changing multi-session chat behavior in the UI
title: "Chat Sessions"
---

# Chat Sessions

The assistant dock now supports multiple chat sessions using the same tab style as the Email workspace.

## Behavior

- Each tab represents a separate chat session.
- Creating a new tab starts a new session with its own isolated message history and in-memory assistant context.
- Switching tabs restores that session's messages instead of mixing conversation state across tabs.

## Persistence

- Session tabs persist in local storage.
- Session tabs and message history also fall back to session storage when local storage writes fail.
- Each session stores its own message history independently.
- Switching tabs restores that session's transcript, but in-progress assistant
  typing/streaming UI does not auto-resume across sessions.
- Session return now restores durable assistant runtime context for that tab,
  including active workflow/task state, pending tool-plan confirmation state,
  browser-viewer state, and session-scoped UI orchestration flows.
- Assistant UI targeting is now scoped to the active chat session at runtime, so
  switching tabs swaps which session-owned target state is rendered instead of
  leaking a highlighted control or panel across tabs.
- Durable assistant UI flows are also stored per chat session. If a session is
  in the `create_contact` flow and has already advanced to the form panel,
  returning to that session restores the current flow step instead of replaying
  the earlier button step.
- Restored history is not reinterpreted as a fresh assistant response on tab
  return, so resuming a session does not replay the most recent guidance action
  from the top.
- The chat provider also keeps an in-memory snapshot per session during the current app runtime, so switching chat tabs does not depend on storage write timing.
- The persistence service keeps a memory fallback for tabs, active-session selection, and transcripts if browser storage rejects a write during the current runtime.
- Tab switches only persist messages after the destination session finishes hydrating, preventing one session from overwriting another during rapid tab changes.
- The active session is restored when the app reloads.

## UI

- The dock header uses the shared `EmailTabs` visual treatment for consistency with the rest of the workspace.
- `New Session` creates an additional tab without replacing existing conversations.
