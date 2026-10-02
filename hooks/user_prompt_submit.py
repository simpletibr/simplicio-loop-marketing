#!/usr/bin/env python3
"""Run the canonical Claude adapter for UserPromptSubmit."""
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

from adapters.claude.adapter import decide  # noqa: E402


def main() -> int:
    try:
        event = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        event = {}
    event.setdefault("hook_event_name", "UserPromptSubmit")
    decision = decide(event)
    print(json.dumps(decision, ensure_ascii=False))
    return 0 if decision.get("decision") != "block" else 2


if __name__ == "__main__":
    raise SystemExit(main())
