#!/usr/bin/env python3
"""simplicio-loop — capture hook (Cursor `afterAgentResponse`).

Transport only: stash the latest assistant response so the shared completion oracle
can evaluate it later in the stop hook. This hook never decides completion and never
raises `done` on its own.
"""
import json
import os
import sys

LOOP_DIR = os.path.join(".simplicio-loop/orchestrator", "loop")
LAST_RESP = os.path.join(LOOP_DIR, "last_response.txt")


def main():
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
        resp = data.get("text", "") or ""
        if resp:
            os.makedirs(LOOP_DIR, exist_ok=True)
            with open(LAST_RESP, "w", encoding="utf-8") as f:
                f.write(resp)
    except Exception:
        pass
    sys.exit(0)


if __name__ == "__main__":
    main()
