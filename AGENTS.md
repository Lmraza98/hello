# Repository Guidelines

## Documentation Contract

- Keep docs synchronized with behavior changes in the same task.
- If you modify code under `api/`, `services/`, `ui/src/`, or `zco-bi/`, update relevant docs under `docs/` (or `README.md`) before finishing.
- Regenerate API docs when route contracts change:
  - `python scripts/export_api_docs.py`
- Run docs checks before handoff:
  - `python scripts/docs_ci.py`
  - `python scripts/docs_guard.py`

## Docs Entry Points

- `docs/start/docs-directory.md`
- `docs/start/hubs.md`
- `docs/help/context-recovery.md`
- `docs/help/documentation-workflow.md`

## UI Interaction Model

This app uses a capability-based UI action system. The assistant can emit:

```json
{
  "actions": [
    { "action": "companies.navigate" },
    { "action": "companies.search", "q": "healthcare" },
    { "action": "contacts.select_row", "contact_id": 42 }
  ]
}
```

### Capability Reference

- Canonical generated reference: `ui/src/capabilities/generated/AGENT_CAPABILITIES.md`
- Full generated registry: `ui/src/capabilities/generated/registry.json`
- Generated TypeScript schema: `ui/src/capabilities/generated/schema.ts`
- Docs index/mirror: `docs/AGENT_CAPABILITIES.md`

### Adding New Capabilities

1. Update `ui/src/capabilities/source.json`
2. Run `npm --prefix ui run generate:capabilities`
3. If needed, add a concrete execution mapping in `ui/src/chat/actionExecutor.ts`
4. If your environment can write to `docs/`, mirror docs update is automatic; otherwise keep using the canonical generated file above.

### Conventions

- Action IDs: `{page}.{action_name}`
- Destructive actions require confirmation
- Mutation actions should define conditions when applicable
- Keep action/filter descriptions short and explicit for prompt grounding
