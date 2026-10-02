---
name: simplicio-compress
description: Cut output and memory tokens without losing meaning — terse prose levels (caveman-style) that preserve code/paths/URLs byte-for-byte, plus a one-time memory/doc compaction pass that pays back every future turn. Use when replies or worker reports are verbose, when standing context (AGENTS.md/notes) is bloated, or when simplicio-tasks needs its output-side + input-side token discipline. Compression NEVER touches code, identifiers, or a safety confirmation.
---

<!-- simplicio-contract:begin -->
contract: simplicio-compress
schema: simplicio.skill/v1
purpose: Cut output and memory tokens without losing meaning — terse prose levels (caveman-style) that preserve code/paths/URLs byte-for-byte, plus a one-time memory/doc compaction pass that pays back every future turn.
rules: Follow this skill end-to-end; mutable data (versions, dates, counts) lives in the footer, never in this header.
<!-- simplicio-contract:end -->

# simplicio-compress — output & memory token discipline

Two distinct surfaces, two passes:

1. **Output-side** — compress the model's own PROSE (replies, reports, digests).
2. **Input-side** — compress STANDING context once (memory/docs), amortized across every turn.

Both preserve every load-bearing token exactly. Credit: folds **caveman** (terse prose levels,
byte-preserve identifiers, memory-file compaction, honest baseline) into the simplicio
`transform_guard` safety spine. This is the standalone form of `simplicio-tasks`' density tiers
+ one-time standing-context compaction.

## Output-side: prose levels

Pick the leanest level that still reads correctly; default `full`. The level applies to PROSE
ONLY:

| Level | Use | Effect |
|---|---|---|
| `lite` | human-facing PR bodies, confirmations | drop filler ("I will now", "let me", hedging); keep full sentences |
| `full` | default | normal terse technical prose |
| `ultra` | worker→orchestrator reports, internal digests | telegraphic fragments; articles/copulas dropped |

There is NO grammar-mangling level. Terse prose is fine; mangling grammar degrades code review,
confirmations, and instructions — we keep the *discipline*, not the gimmick.

## The one inviolable rule (byte-preservation)

Code, commands, error strings, URLs, file paths, identifiers, version/numeric tokens stay
**EXACT** — never paraphrased, reflowed, or "cleaned up". Compression rewrites the connective
prose AROUND them, never them. A safety confirmation, irreversible-op warning, or order-dependent
sequence is NEVER compressed (auto-clarity — see `simplicio-orient`).

## transform_guard (zero-LLM, fail-closed) — runs on every compaction

Before accepting ANY compressed artifact, run a deterministic check with NO model tokens:
extract the set of code fences, inline-code tokens (BY OCCURRENCE count, so a lost duplicate is
caught), URLs, file paths, and version/numeric tokens from BEFORE and AFTER.

- Any LOST code/URL/path/version token → **HARD failure**: discard the compaction, keep the
  original byte-identical.
- Heading/bullet-count drift → WARNING only.
- On hard failure, issue ONE targeted fix touching only the flagged tokens (max 2 retries);
  still failing → abort to original. Never ship a silently-corrupted artifact.

## Input-side: one-time memory/doc compaction

The orchestrator re-loads its standing protocol + shared digest + memory on EVERY tick —
compacting them ONCE pays back across hundreds of iterations (caveman reports ~46% input
reduction on memory files).

Procedure:
1. Target prose-heavy standing files (AGENTS.md, shared digest, long notes). Skip
   pure code/config/lockfiles.
2. Rewrite to terse form preserving code/paths/URLs/numbers/versions VERBATIM; run through
   `transform_guard`.
3. Keep a `.original` backup; in mixed files touch ONLY prose, never code blocks.
4. Load the compact form thereafter; re-compact only when the source materially changes.

## Honest savings (the caveman baseline nuance)

Report savings against a **realistic control arm** — the cheapest sensible NON-orchestrated path
to the SAME outcome (a generic *terse* "answer concisely" LLM pass over only the files genuinely
needed) — NOT a verbose strawman that assumes bulk-reading the whole repo at max verbosity.

- `saved = baseline − spent`, disclosed as approximate.
- Savings counts **only on a verified-correct outcome** (the item passed run-verification +
  acceptance criteria). Aggressive compression that fails its gate earns ZERO credit — else the
  metric rewards the degenerate "empty answer maximizes savings".
- These are OUTPUT-token reductions; note that thinking/reasoning tokens are untouched.

Emit the standard line:
```
simplicio-tasks: ~<spent> tokens · baseline ~<control-arm> · saved ~<saved> (<pct>%)
```

## Guardrails

- Never compress: code, config, lockfiles, secrets-adjacent text, safety confirmations.
- Never paraphrase an identifier to "save a token" — `transform_guard` will fail closed.
- A compaction that can't pass the guard is reverted, not shipped.

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
