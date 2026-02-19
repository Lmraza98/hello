---
summary: "Operational workflow for keeping docs synchronized with code and API changes."
read_when:
  - You changed behavior in api, services, or ui
  - You want to prevent documentation drift before commit
title: "Documentation Workflow"
---

# Documentation Workflow

This repository uses an OpenClaw-style docs contract: code changes that alter behavior must be reflected in docs during the same work cycle.

## Required Routine

1. Update relevant docs pages.
2. Regenerate API docs.
3. Run docs checks.
4. Fail the change if docs drift remains.

## Commands

Run the full docs pipeline:

```bash
python scripts/docs_ci.py
```

Check if code changes are missing docs updates:

```bash
python scripts/docs_guard.py
```

Check staged changes only:

```bash
python scripts/docs_guard.py --staged
```

Regenerate UI capability artifacts:

```bash
npm --prefix ui run generate:capabilities
```

Enforce docs mirror write (CI/release use):

```bash
python scripts/generate_capabilities.py --strict-docs-mirror
```

## What Counts as a Docs Update

At least one of:

- A page under `docs/**/*.md` or `docs/**/*.mdx`
- `docs/docs.json` navigation/redirect updates
- `README.md` updates for top-level operational changes

## Definition Of Done

- Behavior change has a matching docs change.
- `python scripts/docs_ci.py` succeeds.
- `python scripts/docs_guard.py` succeeds (or explicitly documented why skipped).

## Capability Generation Contract

- Canonical generated capability docs live in `ui/src/capabilities/generated/AGENT_CAPABILITIES.md`.
- `docs/AGENT_CAPABILITIES.md` is a lightweight index page that points to canonical generated artifacts.
- In restricted environments, subprocess writes to `docs/` can fail; generation still succeeds as long as canonical artifacts are written.
- Use `--strict-docs-mirror` only when your pipeline requires docs mirror writes to succeed.
