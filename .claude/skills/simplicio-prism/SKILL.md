---
name: simplicio-prism
description: Route broad or ambiguous work across Simplicio Mapper, Dev CLI, and Loop. Use when a request spans components, requires choosing the correct capability, needs an end-to-end workflow, or the agent is unsure which Simplicio skill to invoke. Prism classifies and composes; it does not execute mutations itself.
---

<!-- simplicio-contract:begin -->
contract: simplicio-prism
schema: simplicio.skill/v1
purpose: Route broad or ambiguous work across Simplicio Mapper, Fast, Dev CLI, and Loop.
rules: Follow this skill end-to-end; mutable data (versions, dates, counts) lives in the footer, never in this header.
<!-- simplicio-contract:end -->

# Simplicio Prism

## Worker preflight and centralized artifact policy

Before routing or operating, each worker reads repository `AGENTS.md` and all relevant local skills. Prism only composes a route after that preflight. One binary/artifact set is built centrally from the canonical default branch and shared read-only; workers never rebuild binaries or regenerate canonical Mapper artifacts. Worktrees isolate source edits and receipts only. Route evidence and receipts carry repository/revision, binary digest/version, Mapper generation, and artifact digest. Missing, stale, incompatible, or mismatched central artifacts fail closed and select the central rebuild path only.

Loop/Prism uses Python `asyncio` for scheduling, leases, and I/O; there is no Runtime/MCP backend in this stack. Asyncio scheduling never authorizes a worker-local rebuild or canonical artifact regeneration.


Use Prism as the top-level capability router. Read `references/capabilities.yaml` for routing rules and `references/recipes.md` for end-to-end compositions. Load a component skill only after Prism has selected it; do not duplicate component documentation here.

## Generate the complete interface map

Run the inventory generator against the actual checkout before relying on an interface:

```bash
python3 scripts/generate_capability_inventory.py /path/to/repository \
  --output /path/to/repository/capability-inventory.json
python3 scripts/generate_capability_inventory.py \
  --validate /path/to/repository/capability-inventory.json
```

The inventory covers CLI entry points and subcommands, MCP registrations, public Python and Rust APIs, configuration files, inferred inputs/outputs/effects, observed errors and fallbacks, dependency/version data, compatibility, and cost estimates. Static cost and semantic contracts remain `requires_review` until measured or supplied in `capability-overrides.json`. Use `references/capability-record.schema.json` and `references/discovery.md` to interpret confidence.

## Routing algorithm

1. Classify intent as survey, retrieve, mutate, validate, orchestrate, govern, or mixed.
2. Check repository, revision, scope, availability, preconditions, and side-effect policy.
3. Select the smallest capability set and order dependencies before dependents.
4. Require Mapper before non-trivial mutation; require Dev CLI for mutation.
5. Add Loop for multi-step, parallel, retryable, or convergent work.
6. Emit a routing decision with reasons, fallbacks, and expected evidence.

For task-count routing, one to three tasks use direct parallelism; more than three tasks activate
Prism. An omitted quantity defaults to a minimum logical batch of ten tasks per slot. Slot count,
slot capacity, and Prism wave width have no logical upper bound; physical resource/lease governors
may still defer execution. Always route from the fresh Mapper snapshot.

## Non-negotiable boundaries

- Prism never edits files and never fabricates a capability.
- Unknown or unavailable capabilities become explicit `unresolved` items.
- A reported success is not completion until the selected verifier proves it.
- Prefer the cheapest capability that satisfies the contract.

## Contract

Return `route_id`, `intent`, `selected_capabilities`, `order`, `preconditions`, `fallbacks`, `cost_estimate`, `evidence_requirements`, and `unresolved`.

## Resources

- `references/capabilities.yaml`: cross-component registry and decision matrix.
- `references/recipes.md`: tested compositions for common workflows.
- `scripts/probe-capabilities.py`: validate the registry and detect duplicate IDs.

## Standalone precedence

There is no Runtime/MCP backend in this stack. Each component package (Mapper,
Dev CLI, Loop) is callable standalone; direct file edits go through
`simplicio-dev-cli edit --plan`.

## What the model sees

When a host loads this skill, the model receives the YAML frontmatter, the
immutable `simplicio-contract` header, and this body, verbatim. Files under
`references/` enter the context only when this body points to them. Nothing
here is generated per run.

### Token effect

The body is paid once per session as input tokens. References are paid only on
demand, so the always-loaded part stays the short hot path.

### KV cache effect

The frontmatter and header are byte-stable across releases (pinned in
`contracts/headers.lock.json`), and mutable data lives only at the end of the
file. The provider can therefore reuse the cached prefix from the second call
on, and a release does not invalidate it unless a `header-change:` note says so.
