#!/usr/bin/env python3
"""Run the canonical Claude adapter for UserPromptSubmit.

Not registered in hooks/hooks.claude.json in this repo: the simplicio-loop 3.47.0 wheel
ships this hook but not the `adapters/claude/adapter.py` it delegates to (upstream issue
simpletibr/simplicio-loop#1410). If it is invoked anyway and the adapter cannot be
imported, it runs in explicit degraded mode: a warning on stderr, an empty decision on
stdout and exit 0, so a user prompt is never broken by a missing optional enrichment.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def _repo_root() -> Path:
    current = Path(__file__).resolve()
    for candidate in (current, *current.parents):
        if (candidate / "adapters" / "claude" / "adapter.py").is_file():
            return candidate
    return current.parents[1]


ROOT = _repo_root()
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _load_decide():
    try:
        from adapters.claude.adapter import decide
    except ImportError as exc:
        print(
            "simplicio-loop user_prompt_submit: degraded mode, Claude adapter unavailable "
            "(%s); prompt passed through unchanged" % exc,
            file=sys.stderr,
        )
        return None
    return decide


def main() -> int:
    try:
        event = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        event = {}
    if not isinstance(event, dict):
        event = {}
    event.setdefault("hook_event_name", "UserPromptSubmit")
    decide = _load_decide()
    if decide is None:
        print(json.dumps({}))
        return 0
    decision = decide(event)
    print(json.dumps(decision, ensure_ascii=False))
    return 0 if decision.get("decision") != "block" else 2


if __name__ == "__main__":
    raise SystemExit(main())
