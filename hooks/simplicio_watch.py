#!/usr/bin/env python3
"""Simplicio Token Monitor (CLI watch) — proxy + savings status for simplicio-loop.

Drives the native Simplicio capture engine (`engine/simplicio_engine.py`) — no external
dependency. Proxy reachability and lifetime savings come from the engine's own
`doctor` / `memory stats` subcommands.

Usage:
    python3 hooks/simplicio_watch.py status    # show proxy + savings status
    python3 hooks/simplicio_watch.py start     # start the compression proxy
    python3 hooks/simplicio_watch.py stop      # stop the compression proxy
"""
import os
import subprocess
import sys
from pathlib import Path


try:  # Status icons and protocol output must survive Windows cp1252 consoles.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HOME = os.path.expanduser("~")
LOGS = os.path.join(HOME, ".simplicio-loop", "logs")
REPO_ROOT = Path(__file__).resolve().parents[1]
_SCRIPTS_DIR = str(REPO_ROOT / "scripts")
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
try:
    # tolerant JSONL reader (#127) — the savings ledger is written by the external `simplicio`
    # runtime, never by this repo; we only ever READ it, so hardening here means counting valid
    # vs. corrupt/truncated lines instead of a naive `sum(1 for _ in file)` that treats a torn
    # line the same as a real event. Fail-open: missing helper -> fall back to the raw count.
    from _locked_append import count_jsonl_lines
except Exception:
    count_jsonl_lines = None
# Native engine: invoked cross-platform via this interpreter (no external binary).
ENGINE_CMD = [sys.executable or "python3", str(REPO_ROOT / "engine" / "simplicio_engine.py")]
PROXY_PORT = os.environ.get("SIMPLICIO_PROXY_PORT", "8788")
PROXY_SERVICE = "ai.simplicio.proxy"


def log(msg):
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    try:
        msg = str(msg).encode(encoding).decode(encoding)
    except UnicodeEncodeError:
        msg = str(msg).encode(encoding, errors="replace").decode(encoding)
    print(msg)


def run(cmd, timeout=10):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.stdout.strip(), r.returncode
    except Exception as e:
        return str(e), -1


def status():
    out, _ = run([*ENGINE_CMD, "doctor", "--port", PROXY_PORT])
    running = "running" in out.lower() and "not reachable" not in out.lower()
    if running:
        log(f"✅ Simplicio proxy — RUNNING (port {PROXY_PORT})")
    else:
        log("❌ Simplicio proxy — NOT RUNNING")
    for line in out.split("\n"):
        if line.strip().startswith(("proxy:", "savings:")):
            log(f"  {line.strip()}")
    out2, _ = run([*ENGINE_CMD, "memory", "stats"])
    for line in out2.split("\n"):
        if "Total" in line or "Database" in line:
            log(f"  {line.strip()}")
    # Savings ledger — tolerant count (#127): a truncated/illegible line is counted, not silently
    # folded into the total as if it were a real event.
    ledger = REPO_ROOT / ".simplicio-loop" / "ledger" / "savings-events.jsonl"
    if ledger.is_file():
        if count_jsonl_lines is not None:
            valid, corrupt = count_jsonl_lines(str(ledger))
            suffix = f" ({corrupt} corrupt line(s) skipped)" if corrupt else ""
            log(f"  💰 Savings ledger: {valid} events{suffix}")
        else:
            total = sum(1 for _ in ledger.open(errors="replace"))
            log(f"  💰 Savings ledger: {total} events")
    log(f"  🪵 Logs: {LOGS}/proxy.log")
    return 0 if running else 1


def start():
    log(f"Starting Simplicio compression proxy on port {PROXY_PORT}...")
    log(f"  Use: scripts/simplicio-engine proxy --port {PROXY_PORT}")
    log(f"  Or as a service: launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/{PROXY_SERVICE}.plist")
    return 0


def stop():
    log("Stopping Simplicio compression proxy...")
    run(["launchctl", "bootout", f"gui/{os.getuid()}/{PROXY_SERVICE}"])
    log("  Stopped.")
    return 0


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    dispatch = {"status": status, "start": start, "stop": stop}
    if cmd in dispatch:
        sys.exit(dispatch[cmd]())
    print(f"Usage: {sys.argv[0]} {{status|start|stop}}")
    sys.exit(1)


if __name__ == "__main__":
    main()
