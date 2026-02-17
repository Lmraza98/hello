---
title: "Agent Capabilities"
summary: "Capability-based UI action catalog and generation workflow."
---

# Agent Capabilities

The canonical generated capability reference is:

- `ui/src/capabilities/generated/AGENT_CAPABILITIES.md`

Related generated artifacts:

- `ui/src/capabilities/generated/registry.json`
- `ui/src/capabilities/generated/schema.ts`

Regenerate with:

- `npm --prefix ui run generate:capabilities`

Notes:

- Some environments deny subprocess writes to `docs/`.
- Use `python scripts/generate_capabilities.py --strict-docs-mirror` in CI/release if docs mirror write must succeed.
