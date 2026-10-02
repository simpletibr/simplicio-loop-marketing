#!/usr/bin/env python3
"""Simplicio Token Monitor — web dashboard + monitor for token savings.

Reads the Simplicio capture proxy's structured savings file (proxy_savings.json)
plus its log, and renders a data-forward dashboard: real-time token chart + which
LLMs/runtimes are actually interceptable. The capture engine is invoked only via the
Simplicio-branded wrapper `scripts/simplicio-engine`.

Usage:
    python3 hooks/simplicio_dashboard.py              # start web server on :9090
    python3 hooks/simplicio_dashboard.py --port 9091

Front-end is split into STYLE / BADGE_SVG / BODY / SCRIPT constants and composed
into HTML via placeholder substitution — single-file (deploy-friendly).
"""
import calendar
import http.server
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.parse
from pathlib import Path

HOME = os.path.expanduser("~")
REPO_ROOT = Path(__file__).resolve().parents[1]
_SCRIPTS_DIR = str(REPO_ROOT / "scripts")
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
try:
    # tolerant JSONL reader (#127) — see hooks/simplicio_watch.py for the same rationale: the
    # savings ledger is written by the external `simplicio` runtime, never by this repo.
    from _locked_append import count_jsonl_lines
except Exception:
    count_jsonl_lines = None
# Structured savings file written by the capture engine — the primary data source.
SAVINGS_JSON_CANDIDATES = [
    Path(HOME) / ".simplicio-loop" / "proxy_savings.json",
]
# Raw proxy log (Simplicio-named first; engine dir kept for back-compat).
LOG_CANDIDATES = [
    Path(HOME) / ".simplicio-loop" / "logs" / "proxy.log",
    Path(HOME) / ".simplicio-agent" / "logs" / "simplicio-proxy.log",
    Path(HOME) / ".hermes" / "logs" / "simplicio-proxy.log",  # legacy alias, compat window
]
LOGO_CANDIDATES = [
    REPO_ROOT / "assets" / "simplicio-loop-logo.png",
    Path(HOME) / "Projetos" / "ai" / "simplicio-runtime" / "site" / "assets" / "img" / "simplicio-logo.png",
]
# Cross-platform temp dir (Windows has no /tmp) — must match simplicio_loop/cli.py PID_FILE.
PID_FILE = Path(tempfile.gettempdir()) / "simplicio-token-monitor.pid"
PROXY_PORT = os.environ.get("SIMPLICIO_PROXY_PORT", "8788")
# Optional run projection for the visual dashboard.  It is deliberately opt-in: the token
# monitor remains useful without a repository checkout or an active loop run.
PROGRESS_RUN = os.environ.get("SIMPLICIO_PROGRESS_RUN", "").strip()
# Engine call: the native Simplicio engine module, invoked cross-platform via this interpreter.
ENGINE_CMD = [sys.executable or "python3", str(REPO_ROOT / "engine" / "simplicio_engine.py")]

# Each runtime: skills LOAD, loop DRIVE, coverage STATE, the token INTERCEPT tier
# (native = durable engine integration; baseurl = route its base_url through the proxy),
# and `proc` — a regex to detect whether the runtime is currently RUNNING (for the live
# "active / blinking" indicator). Only interceptable runtimes are listed; proprietary
# Google/AWS runtimes (Gemini/Kiro/Antigravity) were removed — they can't be intercepted.
RUNTIMES = [
    {"name": "Claude", "load": ".claude/skills", "loop": "Stop hook", "state": "full", "intercept": "native", "logo": "claude", "proc": r"Claude\.app|claude --|claude-code", "families": ["anthropic"]},
    {"name": "Codex", "load": "AGENTS.md", "loop": "self-paced", "state": "partial", "intercept": "native", "logo": "openai", "proc": r"\bcodex\b", "families": ["openai"]},
    {"name": "VS Code", "load": "copilot instructions", "loop": "tasks", "state": "partial", "intercept": "native", "logo": "vscode", "proc": r"Visual Studio Code|Code Helper|Copilot", "families": ["openai"]},
    {"name": "OpenClaw", "load": "plugin SDK", "loop": "native loop", "state": "native", "intercept": "native", "logo": "openclaw", "proc": r"openclaw", "families": ["openai", "anthropic"]},
    {"name": "Simplicio Agent", "load": "native recall", "loop": "native loop", "state": "native", "intercept": "baseurl", "logo": "simplicio_agent", "proc": r"simplicio-agent", "families": ["deepseek", "openai"]},
    {"name": "Hermes (legacy)", "load": "native recall", "loop": "native loop", "state": "native", "intercept": "baseurl", "logo": "hermes", "proc": r"hermes", "families": ["deepseek", "openai"]},
    {"name": "Cursor", "load": ".cursor-plugin", "loop": "Stop hook", "state": "full", "intercept": "baseurl", "logo": "cursor", "proc": r"Cursor\.app|Cursor Helper", "families": ["openai", "anthropic"]},
    {"name": "OpenCode", "load": "AGENTS.md", "loop": "self-paced", "state": "partial", "intercept": "baseurl", "logo": "opencode", "proc": r"opencode", "families": ["openai", "anthropic"]},
    {"name": "Gemini", "load": "GEMINI.md", "loop": "self-paced", "state": "partial", "intercept": "none", "logo": "gemini", "proc": r"\bgemini\b", "families": []},
    {"name": "Kiro", "load": ".kiro/steering", "loop": "spec tick", "state": "partial", "intercept": "none", "logo": "kiro", "proc": r"\bkiro\b", "families": []},
    {"name": "Antigravity", "load": "rules", "loop": "self-paced", "state": "partial", "intercept": "none", "logo": "antigravity", "proc": r"antigravity", "families": []},
]

# ── Brand badge: faithful inline vector of the Simplicio hexagon-S mark ───────
BADGE_SVG = """<svg viewBox="0 0 240 224" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Simplicio">
  <defs>
    <linearGradient id="sFace" x1="0" y1="0" x2="0.2" y2="1">
      <stop offset="0" stop-color="#e4ff5a"/><stop offset="0.55" stop-color="#9cf614"/><stop offset="1" stop-color="#6fd000"/>
    </linearGradient>
    <linearGradient id="sSide" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3c8a10"/><stop offset="1" stop-color="#1f5a06"/>
    </linearGradient>
    <linearGradient id="layerTop" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#caff3a"/><stop offset="1" stop-color="#7fe000"/>
    </linearGradient>
    <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <g stroke="#8cff00" stroke-width="3.4" fill="none" opacity="0.92" stroke-linecap="round">
    <path d="M168 86 H214"/><path d="M168 112 H206"/><path d="M168 138 H214"/>
  </g>
  <g fill="#03060a" stroke="#8cff00" stroke-width="3.4">
    <circle cx="222" cy="86" r="6"/><circle cx="214" cy="112" r="6"/>
    <rect x="216" y="131.5" width="13" height="13" rx="2"/>
  </g>
  <g fill="#caff26">
    <rect x="44" y="98" width="18" height="5" rx="2"/><rect x="22" y="98" width="11" height="5" rx="2"/>
    <rect x="50" y="112" width="12" height="5" rx="2" opacity="0.85"/><rect x="30" y="112" width="7" height="5" rx="2" opacity="0.7"/>
    <rect x="40" y="126" width="15" height="5" rx="2" opacity="0.8"/><rect x="18" y="126" width="9" height="5" rx="2" opacity="0.6"/>
  </g>
  <path d="M120 20 192 62 V150 L120 192 48 150 V62 Z" fill="none" stroke="#8cff00"
        stroke-width="7" stroke-linejoin="round" filter="url(#glow)"/>
  <path d="M150 66 H96 a22 22 0 0 0 -22 22 v6 a22 22 0 0 0 22 22 h30 a9 9 0 0 1 0 18 H72 v22 h60
           a22 22 0 0 0 22 -22 v-6 a22 22 0 0 0 -22 -22 H100 a9 9 0 0 1 0 -18 h56 Z"
        fill="url(#sSide)" transform="translate(6,7)"/>
  <path d="M150 66 H96 a22 22 0 0 0 -22 22 v6 a22 22 0 0 0 22 22 h30 a9 9 0 0 1 0 18 H72 v22 h60
           a22 22 0 0 0 22 -22 v-6 a22 22 0 0 0 -22 -22 H100 a9 9 0 0 1 0 -18 h56 Z"
        fill="url(#sFace)"/>
  <g transform="translate(120,108)">
    <path d="M-26 6 0 -7 26 6 0 19 Z" fill="url(#layerTop)" stroke="#04060a" stroke-width="2"/>
    <path d="M-26 -4 0 -17 26 -4 0 9 Z" fill="#a6ff1f" stroke="#04060a" stroke-width="2"/>
    <path d="M-26 -14 0 -27 26 -14 0 -1 Z" fill="#c9ff45" stroke="#04060a" stroke-width="2"/>
  </g>
</svg>"""

STYLE = """<style>
  :root {
    --bg: #03060a; --panel: #070f0b; --panel-2: #0a1510;
    --line: #14352a; --line-soft: #0f2419;
    --text: #eafff0; --muted: #86a89a; --faint: #3a5547;
    --green: #9dff1a; --lime: #caff26; --cyan: #36d7ff;
    --yellow: #ffd23f; --amber: #ffc857; --red: #ff5e6c; --violet: #b88cff;
    --glow: 0 0 26px rgba(157,255,26,0.22);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html { scrollbar-color: var(--line) transparent; }
  body {
    font-family: "Chakra Petch", "IBM Plex Mono", ui-monospace, "SF Mono", monospace;
    background:
      radial-gradient(1000px 480px at 50% -10%, rgba(157,255,26,0.07), transparent 70%),
      linear-gradient(rgba(157,255,26,0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(157,255,26,0.018) 1px, transparent 1px),
      var(--bg);
    background-size: auto, 36px 36px, 36px 36px;
    color: var(--text); padding: 16px 18px 32px; min-height: 100vh;
  }
  .wrap { max-width: 1360px; margin: 0 auto; }

  /* ── compact top bar (small logo, no empty space) ─────────────── */
  .topbar { display: flex; justify-content: space-between; align-items: center; gap: 14px;
            flex-wrap: wrap; padding: 10px 14px; margin-bottom: 14px; border: 1px solid var(--line);
            border-radius: 12px; background: linear-gradient(120deg, var(--panel-2), var(--panel));
            box-shadow: var(--glow); }
  .brandbar { display: flex; align-items: center; gap: 12px; min-width: 0; }
  .badgemini { width: 40px; height: 38px; display: inline-flex; filter: drop-shadow(0 0 8px rgba(157,255,26,0.5)); flex: none; }
  .badgemini svg { width: 100%; height: 100%; }
  .bwords { display: flex; flex-direction: column; line-height: 1.05; min-width: 0; }
  .bwords .name { font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; font-size: 1.05rem; }
  .bwords .name .tm-g { color: var(--green); text-shadow: 0 0 12px rgba(157,255,26,0.5); }
  .bwords .name .tm-y { color: var(--yellow); text-shadow: 0 0 12px rgba(255,210,63,0.45); }
  .bwords em { font-style: normal; color: var(--faint); font-size: 0.6rem; letter-spacing: 0.14em; text-transform: uppercase; margin-top: 2px; }
  .chips { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .chip { display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border: 1px solid var(--line);
          border-radius: 999px; background: rgba(0,0,0,0.32); font-size: 0.66rem; text-transform: uppercase;
          letter-spacing: 0.05em; color: var(--muted); white-space: nowrap; }
  .chip b { color: var(--text); font-variant-numeric: tabular-nums; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); box-shadow: 0 0 10px rgba(255,94,108,0.7); }
  .dot.green { background: var(--green); box-shadow: 0 0 12px rgba(157,255,26,0.9); }
  .dot.blue { background: var(--cyan); box-shadow: 0 0 12px rgba(54,215,255,0.85); }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
  .live-dot { animation: pulse 1.5s ease-in-out infinite; }

  /* ── active LLM banner ────────────────────────────────────────── */
  .active-llm { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 11px 16px; margin-bottom: 14px;
                border: 1px solid var(--line); border-radius: 12px;
                background: linear-gradient(90deg, rgba(157,255,26,0.09), rgba(7,15,11,0.55) 46%); }
  .active-llm.idle { opacity: 0.6; }
  .al-logo { width: 34px; height: 34px; flex: none; display: inline-flex; align-items: center; justify-content: center;
             border: 1px solid var(--line); border-radius: 9px; background: rgba(0,0,0,0.4); }
  .al-logo svg { width: 22px; height: 22px; }
  .al-bolt { color: var(--yellow); font-size: 1.05rem; text-shadow: 0 0 10px rgba(255,210,63,0.6); }
  .active-llm.idle .al-bolt { animation: none; color: var(--faint); text-shadow: none; }
  .al-bolt { animation: pulse 1.6s ease-in-out infinite; }
  .al-text { font-size: 0.86rem; color: var(--muted); letter-spacing: 0.02em; }
  .al-text b { color: var(--green); font-size: 0.94rem; }
  .al-meta { margin-left: auto; font-size: 0.62rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; text-align: right; }
  .al-meta .dt { color: var(--cyan); }
  .al-meta .sv { color: var(--green); }

  /* ── hero data row: savings + real-time chart ─────────────────── */
  .hero-data { display: grid; grid-template-columns: minmax(300px, 0.92fr) minmax(0, 1.6fr); gap: 14px; margin-bottom: 14px; }
  .panel { border: 1px solid var(--line); border-radius: 14px; overflow: hidden;
           background: linear-gradient(180deg, var(--panel-2), var(--panel)); }
  .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 12px;
                padding: 11px 15px; border-bottom: 1px solid var(--line-soft); }
  .panel-head .title { font-size: 0.66rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--text); }
  .panel-head .meta { font-size: 0.6rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--faint); }
  .panel-body { padding: 14px 15px; }

  .savings { display: grid; grid-template-columns: 130px minmax(0,1fr); gap: 16px; align-items: center; }
  .gauge { position: relative; width: 126px; height: 126px; }
  .gauge svg { transform: rotate(-90deg); }
  .gauge .pct { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .gauge .pct b { font-size: 1.7rem; color: var(--green); line-height: 1; text-shadow: 0 0 16px rgba(157,255,26,0.5); font-variant-numeric: tabular-nums; }
  .gauge .pct small { font-size: 0.5rem; letter-spacing: 0.16em; color: var(--muted); text-transform: uppercase; margin-top: 3px; }
  .savings-body { min-width: 0; }
  .savings-body .lead { font-size: 0.6rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .savings-body .big { font-size: clamp(1.7rem, 4vw, 2.9rem); font-weight: 700; line-height: 1; margin: 5px 0 3px;
                       font-variant-numeric: tabular-nums; text-shadow: 0 0 18px rgba(157,255,26,0.28); overflow-wrap: anywhere; }
  .savings-body .big em { color: var(--green); font-style: normal; }
  .savings-body .usd { color: var(--yellow); font-size: 0.74rem; }
  .flow { display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center; margin-top: 12px; }
  .flow .node { padding: 8px 11px; border: 1px solid var(--line); border-radius: 9px; background: rgba(0,0,0,0.28); min-width: 0; }
  .flow .node span { display: block; color: var(--muted); text-transform: uppercase; font-size: 0.54rem; letter-spacing: 0.1em; margin-bottom: 4px; }
  .flow .node strong { color: var(--text); font-size: clamp(0.95rem, 2vw, 1.4rem); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  .flow .node.after strong { color: var(--cyan); }
  .flow .arrow { color: var(--green); font-size: 1.1rem; text-shadow: 0 0 12px rgba(157,255,26,0.7); }

  .chart-card .panel-body { padding: 8px 10px 10px; }
  .chartwrap { position: relative; width: 100%; height: 188px; }
  #chart { width: 100%; height: 100%; display: block; }
  .legend { display: flex; gap: 16px; padding: 4px 6px 0; font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .legend i { width: 16px; height: 3px; border-radius: 2px; display: inline-block; }
  .chart-empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--faint); font-size: 0.7rem; }

  /* ── kpi strip ────────────────────────────────────────────────── */
  .kpi-grid { display: grid; grid-template-columns: repeat(7, minmax(0,1fr)); gap: 10px; margin-bottom: 14px; }
  .card { position: relative; overflow: hidden; padding: 12px 13px 14px; min-height: 96px; border: 1px solid var(--line);
          border-radius: 12px; background: linear-gradient(180deg, var(--panel-2), var(--panel)); transition: border-color .2s, box-shadow .2s, transform .2s; }
  .card:hover { border-color: rgba(157,255,26,0.6); box-shadow: 0 0 22px rgba(157,255,26,0.12); transform: translateY(-1px); }
  .card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px; background: var(--accent, var(--green)); opacity: 0.85; }
  .card .label { font-size: 0.58rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted); margin-bottom: 9px; }
  .card .value { font-size: clamp(1.05rem, 1.6vw, 1.5rem); font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; line-height: 1.04; overflow-wrap: anywhere; }
  .card .sub { font-size: 0.6rem; color: var(--faint); margin-top: 6px; letter-spacing: 0.03em; }
  .card .value.green { color: var(--green); text-shadow: 0 0 12px rgba(157,255,26,0.32); }
  .card .value.amber { color: var(--amber); } .card .value.red { color: var(--red); }
  .card .value.blue { color: var(--cyan); } .card .value.purple { color: var(--violet); } .card .value.yellow { color: var(--yellow); }
  .card .bar { height: 4px; border-radius: 4px; margin-top: 11px; background: rgba(255,255,255,0.07); overflow: hidden; }
  .card .bar .fill { height: 100%; border-radius: 4px; transition: width .5s ease; }
  .card .bar .fill.green { background: var(--green); box-shadow: 0 0 14px rgba(157,255,26,0.7); }
  .card .bar .fill.amber { background: var(--amber); } .card .bar .fill.blue { background: var(--cyan); }
  .card .bar .fill.purple { background: var(--violet); } .card .bar .fill.yellow { background: var(--yellow); }

  /* ── two columns: intercepted LLMs + log ──────────────────────── */
  .cols { display: grid; grid-template-columns: minmax(360px, 1fr) minmax(0, 1.25fr); gap: 14px; }
  .runtime-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 9px; }
  .runtime { position: relative; min-width: 0; padding: 10px 11px; border: 1px solid var(--line-soft);
             border-radius: 10px; background: rgba(0,0,0,0.3); transition: border-color .2s; }
  .runtime:hover { border-color: rgba(157,255,26,0.4); }
  .runtime.none { opacity: 0.62; }
  .runtime.active { border-color: rgba(157,255,26,0.55); box-shadow: 0 0 16px rgba(157,255,26,0.14); }
  .runtime-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
  .rt-id { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
  .rt-logo { width: 22px; height: 22px; flex: none; display: inline-flex; align-items: center; justify-content: center; }
  .rt-logo svg { width: 22px; height: 22px; }
  .runtime-name { color: var(--text); font-weight: 700; font-size: 0.8rem; letter-spacing: 0.02em; overflow-wrap: anywhere; }
  .livecap { display: inline-flex; align-items: center; gap: 5px; font-size: 0.52rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--green); }
  .livecap.cap { color: var(--green); }
  .livecap.act { color: var(--cyan); }
  .livecap.rdy { color: var(--faint); }
  .livecap.rdy .dot { background: var(--faint); box-shadow: none; }
  .cap-badge { display: inline-block; border: 1px solid currentColor; border-radius: 999px; padding: 2px 8px;
               font-size: 0.52rem; letter-spacing: 0.07em; text-transform: uppercase; white-space: nowrap; margin-bottom: 7px; }
  .cap-badge.native { color: var(--green); }
  .cap-badge.baseurl { color: var(--cyan); }
  .cap-badge.none { color: var(--red); }
  .runtime-meta { color: var(--muted); font-size: 0.6rem; line-height: 1.5; }
  .runtime-meta .k { color: var(--faint); }

  .log { font-size: 0.64rem; line-height: 1.7; max-height: 340px; overflow-y: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
  .log::-webkit-scrollbar { width: 7px; } .log::-webkit-scrollbar-track { background: transparent; }
  .log::-webkit-scrollbar-thumb { background: var(--line); border-radius: 7px; }
  .log-line { display: grid; grid-template-columns: minmax(104px,auto) 60px minmax(0,1fr); gap: 9px; padding: 2px 5px; border-radius: 6px; }
  .log-line:hover { background: rgba(157,255,26,0.06); }
  .log-line .ts { color: #355346; white-space: nowrap; }
  .log-line .level { font-weight: 700; }
  .log-line .level.INFO { color: var(--cyan); } .log-line .level.WARNING { color: var(--amber); } .log-line .level.ERROR { color: var(--red); }
  .log-line .msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .log-line .msg .num, .log-line .msg .hl { color: var(--green); }
  .log-empty { color: var(--faint); padding: 8px 4px; }

  .footer { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center;
            color: #355346; font-size: 0.62rem; letter-spacing: 0.05em; margin-top: 14px; }
  .footer .tm-g { color: var(--green); } .footer .tm-y { color: var(--yellow); }

  @media (max-width: 1080px) {
    .hero-data { grid-template-columns: 1fr; }
    .kpi-grid { grid-template-columns: repeat(4, minmax(0,1fr)); }
    .cols { grid-template-columns: 1fr; }
  }
  @media (max-width: 640px) {
    body { padding: 12px 10px 24px; }
    .savings { grid-template-columns: 1fr; justify-items: center; text-align: center; }
    .kpi-grid { grid-template-columns: repeat(2, minmax(0,1fr)); }
    .runtime-grid { grid-template-columns: 1fr; }
    .log-line { grid-template-columns: 1fr; gap: 1px; }
  }
</style>"""

BODY = """<div class="wrap">
  <header class="topbar">
    <div class="brandbar">
      <span class="badgemini">__BADGE__</span>
      <div class="bwords">
        <span class="name"><span class="tm-g">Simplicio</span> <span class="tm-y">Token Monitor</span></span>
        <em>real-time LLM token interception</em>
      </div>
    </div>
    <div class="chips">
      <span class="chip"><span class="dot" id="statusDot"></span><span id="statusLabel">checking</span></span>
      <span class="chip">port <b id="portLabel">--</b></span>
      <span class="chip">uptime <b id="uptimeLabel">--</b></span>
      <span class="chip">intercepting <b id="interceptCount">0</b></span>
      <span class="chip">updated <b id="ts">--</b></span>
    </div>
  </header>

  <div class="active-llm idle" id="activeLlm">
    <span class="al-logo" id="alLogo"></span>
    <span class="al-bolt">&#9889;</span>
    <span class="al-text">Saving tokens for <b id="alModel">awaiting traffic…</b></span>
    <span class="al-meta"><span class="sv" id="alSaved">—</span> saved · last call <span class="dt" id="alWhen">—</span></span>
  </div>

  <section class="hero-data">
    <div class="panel"><div class="panel-head"><div class="title">tokens saved</div><div class="meta">lifetime · compressed path</div></div>
      <div class="panel-body savings">
        <div class="gauge">
          <svg width="126" height="126" viewBox="0 0 126 126">
            <circle cx="63" cy="63" r="52" fill="none" stroke="#14352a" stroke-width="10"/>
            <circle id="gaugeArc" cx="63" cy="63" r="52" fill="none" stroke="#9dff1a" stroke-width="10"
                    stroke-linecap="round" stroke-dasharray="327" stroke-dashoffset="327"
                    style="filter: drop-shadow(0 0 8px rgba(157,255,26,0.6)); transition: stroke-dashoffset .6s ease;"/>
          </svg>
          <div class="pct"><b id="savingsPct">0%</b><small>reduction</small></div>
        </div>
        <div class="savings-body">
          <div class="lead">tokens saved</div>
          <div class="big"><em id="savedBig">0</em></div>
          <div class="usd" id="usdSaved">$0.00 saved</div>
          <div class="flow">
            <div class="node before"><span>before</span><strong id="beforeTokens">0</strong></div>
            <div class="arrow">&rarr;</div>
            <div class="node after"><span>after</span><strong id="afterTokens">0</strong></div>
          </div>
        </div>
      </div>
    </div>

    <div class="panel chart-card"><div class="panel-head"><div class="title">tokens · real-time</div><div class="meta" id="chartMeta">awaiting traffic</div></div>
      <div class="panel-body">
        <div class="chartwrap"><svg id="chart" viewBox="0 0 600 188" preserveAspectRatio="none"></svg></div>
        <div class="legend">
          <span><i style="background:var(--amber)"></i>before</span>
          <span><i style="background:var(--cyan)"></i>after (sent)</span>
          <span><i style="background:rgba(157,255,26,0.5)"></i>saved</span>
        </div>
      </div>
    </div>
  </section>

  <div class="kpi-grid" id="stats"></div>

  <div class="cols">
    <aside class="panel"><div class="panel-head"><div class="title">LLMs / runtimes we intercept</div><div class="meta" id="interceptMeta">--</div></div>
      <div class="panel-body"><div class="runtime-grid" id="runtimeGrid"></div></div>
    </aside>
    <section class="panel"><div class="panel-head"><div class="title">proxy log · live token capture</div><div class="meta" id="logSource">no log yet</div></div>
      <div class="panel-body"><div class="log" id="log"></div></div>
    </section>
  </div>

  <section class="panel" id="progressPanel" hidden>
    <div class="panel-head"><div class="title">loop progress · live receipt</div><div class="meta" id="progressMeta">waiting</div></div>
    <div class="panel-body"><pre class="log" id="progressCard" aria-live="polite"></pre></div>
  </section>

  <div class="footer">
    <span><span class="tm-g">Simplicio</span> <span class="tm-y">Token Monitor</span> · simplicio-loop</span>
    <span id="footMeta">--</span>
  </div>
</div>"""

SCRIPT = """<script>
const GAUGE_CIRC = 327;
const PROGRESS_RUN = __PROGRESS_RUN__;
async function refreshProgress(){
  if(!PROGRESS_RUN) return;
  const panel=document.getElementById('progressPanel'); panel.hidden=false;
  try{
    const r=await fetch('/api/progress?run='+encodeURIComponent(PROGRESS_RUN),{cache:'no-store'});
    const d=await r.json();
    document.getElementById('progressMeta').textContent=(d.run_id||PROGRESS_RUN)+' · '+(d.status||'UNVERIFIED');
    document.getElementById('progressCard').textContent=(d.label||'Progress')+' · '+String(d.percent??0)+'%\n'+
      'gates: '+JSON.stringify(d.gates||{})+'\n'+(d.blockers||[]).map(x=>'blocker: '+x).join('\n');
  }catch(e){ document.getElementById('progressMeta').textContent='UNVERIFIED · '+e; }
}
// Compact brand monograms for each LLM/runtime (recognizable marks, brand-tinted).
const LOGOS = {
  claude:'<svg viewBox="0 0 24 24"><g stroke="#d97757" stroke-width="2.1" stroke-linecap="round"><path d="M12 3v18M3 12h18M5.5 5.5l13 13M18.5 5.5l-13 13"/></g></svg>',
  openai:'<svg viewBox="0 0 24 24"><g fill="none" stroke="#10a37f" stroke-width="1.8"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M5 8l14 8M5 16l14-8"/></g></svg>',
  vscode:'<svg viewBox="0 0 24 24"><path fill="#3aa0e3" d="M17 2l5 2.5v15L17 22l-9-8 3-3 6 5V8l-6 5-3-3z"/><path fill="#3aa0e3" opacity=".55" d="M8 11L4 8 6 7l3 2.5z"/></svg>',
  openclaw:'<svg viewBox="0 0 24 24"><g fill="none" stroke="#ff7a3c" stroke-width="2.1" stroke-linecap="round"><path d="M6 4c0 6 1.5 11 6 14M12 4c.5 6 .3 11 0 14M18 4c0 6-1.5 11-6 14"/></g></svg>',
  simplicio_agent:'<svg viewBox="0 0 24 24"><g stroke="#e0b341" stroke-width="2" fill="none" stroke-linecap="round"><path d="M9 5v14M15 5v14M9 12h6"/><path d="M7 8c-2.2 0-3.5 1.2-3.5 1.2M17 8c2.2 0 3.5 1.2 3.5 1.2" stroke-width="1.4"/></g></svg>',
  hermes:'<svg viewBox="0 0 24 24"><g stroke="#e0b341" stroke-width="2" fill="none" stroke-linecap="round"><path d="M9 5v14M15 5v14M9 12h6"/><path d="M7 8c-2.2 0-3.5 1.2-3.5 1.2M17 8c2.2 0 3.5 1.2 3.5 1.2" stroke-width="1.4"/></g></svg>',
  cursor:'<svg viewBox="0 0 24 24"><path fill="#cfd2d6" opacity=".28" d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path fill="none" stroke="#cfd2d6" stroke-width="1.5" stroke-linejoin="round" d="M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>',
  opencode:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2.5" fill="none" stroke="#9dff1a" stroke-width="1.6"/><path d="M7 9l3 3-3 3M13 15h4" fill="none" stroke="#9dff1a" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  gemini:'<svg viewBox="0 0 24 24"><path fill="#4f8cf7" d="M12 2c.8 5.3 4 8.5 10 10-6 1.5-9.2 4.7-10 10-.8-5.3-4-8.5-10-10 6-1.5 9.2-4.7 10-10z"/></svg>',
  kiro:'<svg viewBox="0 0 24 24"><g stroke="#8b5cf6" stroke-width="2.1" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4v16M8 12l8-8M8 12l8 8"/></g></svg>',
  antigravity:'<svg viewBox="0 0 24 24"><g fill="none" stroke="#4f8cf7" stroke-width="1.5"><circle cx="12" cy="12" r="2.6" fill="#4f8cf7"/><ellipse cx="12" cy="12" rx="9" ry="3.6"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)"/></g></svg>',
  _default:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="#86a89a" stroke-width="2"/></svg>'
};
// LLM family logos (keyed by detected family), for the "active LLM" banner.
const LLM_LOGOS = {
  anthropic: LOGOS.claude, openai: LOGOS.openai, gemini: LOGOS.gemini,
  deepseek:'<svg viewBox="0 0 24 24"><path fill="#4d6bfe" d="M3 12.5c4 .2 6-2 9.2-2s4.5 2 7.8 1c-.7 4.2-4.6 6.6-8.6 6.6S3.4 16.8 3 12.5z"/><circle cx="16.6" cy="10.8" r="1.2" fill="#fff"/></svg>',
  llama:'<svg viewBox="0 0 24 24"><path fill="#0866ff" d="M7 4c-1 4-1 9 1 13 1 2 2.6 3 4 3s3-1 4-3c2-4 2-9 1-13-1.2 3-3 4-5 4S8.2 7 7 4z"/></svg>',
  mistral:'<svg viewBox="0 0 24 24"><g fill="#fa520f"><rect x="3" y="5" width="4" height="4"/><rect x="17" y="5" width="4" height="4"/><rect x="7" y="9" width="4" height="4"/><rect x="13" y="9" width="4" height="4"/></g><rect x="3" y="13" width="18" height="4" fill="#ffd21e"/></svg>',
  qwen:'<svg viewBox="0 0 24 24"><path fill="#6e3ff3" d="M12 3l8.5 15H3.5z" opacity=".55"/><path fill="#6e3ff3" d="M12 9l5 9H7z"/></svg>',
  xai:'<svg viewBox="0 0 24 24"><path fill="#e8e8e8" d="M5 4h3.5l11 16H16zM15.5 4H19L8.5 20H5z"/></svg>',
  kimi:'<svg viewBox="0 0 24 24"><path fill="#03060a" stroke="#9dff1a" stroke-width="1.6" d="M16.5 4a8 8 0 1 0 .2 16 6.2 6.2 0 0 1-.2-16z"/></svg>',
  groq:'<svg viewBox="0 0 24 24"><path fill="#f55036" d="M13.5 2 4 14h6l-1.5 8L20 9h-6.5z"/></svg>',
  default: LOGOS._default
};
function llmFamily(provider, model){
  const s=((model||'')+' '+(provider||'')).toLowerCase();
  if(s.includes('deepseek')) return 'deepseek';
  if(s.includes('claude')||s.includes('anthropic')) return 'anthropic';
  if(s.includes('gemini')||s.includes('google')||s.includes('vertex')) return 'gemini';
  if(/(^|[^a-z])(gpt|o1|o3|o4|chatgpt|openai)([^a-z]|$)/.test(s)) return 'openai';
  if(s.includes('llama')||s.includes('meta-')) return 'llama';
  if(s.includes('mistral')||s.includes('mixtral')||s.includes('codestral')||s.includes('magistral')) return 'mistral';
  if(s.includes('qwen')) return 'qwen';
  if(s.includes('grok')||s.includes('xai')) return 'xai';
  if(s.includes('kimi')||s.includes('moonshot')) return 'kimi';
  if(s.includes('groq')) return 'groq';
  return 'default';
}
function fmtDT(iso){
  if(!iso) return '—';
  const d=new Date(iso); if(isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined,{month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function ago(iso){
  if(!iso) return '';
  const d=new Date(iso); if(isNaN(d.getTime())) return '';
  const s=Math.max(0,(Date.now()-d.getTime())/1000);
  if(s<60) return Math.round(s)+'s ago';
  if(s<3600) return Math.round(s/60)+'m ago';
  if(s<86400) return Math.round(s/3600)+'h ago';
  return Math.round(s/86400)+'d ago';
}
function escapeHTML(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(v){return Number(v||0).toLocaleString();}

function card(label,value,color,sub,bar,barColor){
  label=escapeHTML(label); value=escapeHTML(value); sub=sub?escapeHTML(sub):'';
  const accent={green:'var(--green)',amber:'var(--amber)',red:'var(--red)',blue:'var(--cyan)',purple:'var(--violet)',yellow:'var(--yellow)'}[barColor||color]||'var(--green)';
  const fill=bar?`<div class="bar"><div class="fill ${barColor||color}" style="width:${Math.min(Math.max(bar,0),100)}%"></div></div>`:'';
  const subEl=sub?`<div class="sub">${sub}</div>`:'';
  return `<div class="card" style="--accent:${accent}"><div class="label">${label}</div><div class="value ${color}">${value}</div>${subEl}${fill}</div>`;
}

const CAP_LABEL={native:'intercept · native',baseurl:'intercept · base-url',none:'not interceptable'};
function runtimeCard(r){
  const tier=r.intercept||'none';
  const logo=LOGOS[r.logo]||LOGOS._default;
  let badge='';
  if(r.capturing) badge='<span class="livecap cap"><span class="dot green live-dot"></span>capturing</span>';
  else if(r.active) badge='<span class="livecap act"><span class="dot blue live-dot"></span>active</span>';
  else if(r.live) badge='<span class="livecap rdy"><span class="dot"></span>ready</span>';
  return `<div class="runtime ${tier}${r.active?' active':''}">
    <div class="runtime-top">
      <span class="rt-id"><span class="rt-logo">${logo}</span><span class="runtime-name">${escapeHTML(r.name)}</span></span>${badge}
    </div>
    <span class="cap-badge ${tier}">${CAP_LABEL[tier]}</span>
    <div class="runtime-meta"><span class="k">load</span> ${escapeHTML(r.load)} · <span class="k">drive</span> ${escapeHTML(r.loop)}</div>
  </div>`;
}

function drawChart(series){
  const svg=document.getElementById('chart');
  const W=600,H=188,pad=8;
  if(!series||!series.length){svg.innerHTML='<text x="300" y="98" fill="#3a5547" font-size="13" text-anchor="middle">awaiting proxy traffic…</text>';return;}
  const n=series.length;
  const max=Math.max(1,...series.map(s=>s.before));
  const X=i=>pad+(W-2*pad)*(n<2?0.5:i/(n-1));
  const Y=v=>H-pad-(H-2*pad)*(v/max);
  const ptsBefore=series.map((s,i)=>`${X(i).toFixed(1)},${Y(s.before).toFixed(1)}`).join(' ');
  const ptsAfter=series.map((s,i)=>`${X(i).toFixed(1)},${Y(s.after).toFixed(1)}`).join(' ');
  const top=series.map((s,i)=>`${X(i).toFixed(1)},${Y(s.before).toFixed(1)}`);
  const bot=series.map((s,i)=>`${X(i).toFixed(1)},${Y(s.after).toFixed(1)}`).reverse();
  const area=top.concat(bot).join(' ');
  let grid='';
  for(let g=1;g<4;g++){const y=pad+(H-2*pad)*g/4;grid+=`<line x1="${pad}" y1="${y}" x2="${W-pad}" y2="${y}" stroke="#0f2419" stroke-width="1"/>`;}
  svg.innerHTML=`${grid}<polygon points="${area}" fill="rgba(157,255,26,0.16)"/>
    <polyline points="${ptsBefore}" fill="none" stroke="var(--amber)" stroke-width="1.6" stroke-linejoin="round"/>
    <polyline points="${ptsAfter}" fill="none" stroke="var(--cyan)" stroke-width="1.8" stroke-linejoin="round"/>`;
}

async function refresh(){
  try{
    const d=await (await fetch('/api/status')).json();
    const dot=document.getElementById('statusDot');
    if(d.proxy_running){dot.className='dot green live-dot';document.getElementById('statusLabel').textContent='engine live';}
    else{dot.className='dot';document.getElementById('statusLabel').textContent='engine off';}
    document.getElementById('portLabel').textContent=d.port;
    document.getElementById('uptimeLabel').textContent=d.uptime;
    document.getElementById('ts').textContent=d.timestamp;

    // Active LLM banner — which model we're saving tokens for, with its logo + datetime.
    const am=d.active_model||{};
    const al=document.getElementById('activeLlm');
    if(am.model){
      const fam=llmFamily(am.provider,am.model);
      document.getElementById('alLogo').innerHTML=LLM_LOGOS[fam]||LLM_LOGOS.default;
      document.getElementById('alModel').textContent=am.model+(am.provider&&am.provider!==fam?' ('+am.provider+')':'');
      document.getElementById('alSaved').textContent=fmt(am.saved)+' tok';
      const a=ago(am.timestamp);
      document.getElementById('alWhen').textContent=fmtDT(am.timestamp)+(a?' · '+a:'');
      al.classList.remove('idle');
    }else{
      document.getElementById('alLogo').innerHTML=LLM_LOGOS.default;
      document.getElementById('alModel').textContent='awaiting traffic…';
      document.getElementById('alSaved').textContent='—';
      document.getElementById('alWhen').textContent='—';
      al.classList.add('idle');
    }

    const pct=Math.min(Math.max(d.savings_pct||0,0),100);
    document.getElementById('savingsPct').textContent=(d.savings_pct||0)+'%';
    document.getElementById('gaugeArc').style.strokeDashoffset=GAUGE_CIRC*(1-pct/100);
    document.getElementById('savedBig').textContent=fmt(d.tokens_saved);
    document.getElementById('usdSaved').textContent='$'+(d.usd_saved||0).toFixed(2)+' saved';
    document.getElementById('beforeTokens').textContent=fmt(d.tokens_before);
    document.getElementById('afterTokens').textContent=fmt(d.tokens_after);

    const ser=d.series||[];
    drawChart(ser);
    const lastTs=ser.length?ser[ser.length-1].ts:'';
    document.getElementById('chartMeta').textContent=ser.length?`last ${ser.length} requests · ${fmtDT(lastTs)}`:'awaiting traffic';

    document.getElementById('stats').innerHTML=[
      card('requests',fmt(d.requests),'purple','proxy requests',0,'purple'),
      card('tokens before',fmt(d.tokens_before),'amber','raw input',d.tokens_before>0?Math.min(100,Math.round(d.tokens_before/1000000*100)):0,'amber'),
      card('tokens after',fmt(d.tokens_after),'blue','sent to model',d.tokens_after>0?Math.min(100,Math.round(d.tokens_after/1000000*100)):0,'blue'),
      card('tokens saved',fmt(d.tokens_saved),d.tokens_saved>0?'green':'amber',d.savings_pct+'% reduction',pct,'green'),
      card('$ saved',(d.usd_saved||0).toFixed(3),'yellow','compression cost',0,'yellow'),
      card('tokens out',fmt(d.tokens_out),'blue','model completions',d.tokens_out>0?Math.min(100,Math.round(d.tokens_out/1000000*100)):0,'blue'),
      card('interceptable',d.intercept_ready+'/'+(d.runtimes||[]).length,'green',d.intercept_none+' not yet',Math.round(d.intercept_ready/(d.runtimes||[]).length*100),'green'),
    ].join('');

    document.getElementById('runtimeGrid').innerHTML=(d.runtimes||[]).map(runtimeCard).join('');
    document.getElementById('interceptCount').textContent=(d.active_count||0)+' active / '+d.intercept_ready;
    const provPct=d.provider_total?Math.round(d.provider_interceptable/d.provider_total*100):0;
    const provMeta=d.provider_total?` · ${d.provider_interceptable}/${d.provider_total} providers (${provPct}%)`:'';
    document.getElementById('interceptMeta').textContent=`${d.active_count||0} active · ${d.intercept_ready} interceptable${provMeta}`;
    document.getElementById('logSource').textContent=d.log_source||'no log yet';
    const sess=d.session||{};
    const since=sess.started_at?`session since ${fmtDT(sess.started_at)} · `:'';
    document.getElementById('footMeta').textContent=`${since}${fmt(d.requests)} requests · updated ${d.datetime||d.timestamp}`;

    const logEl=document.getElementById('log');
    const lines=d.log_lines||[];
    if(!lines.length){logEl.innerHTML='<div class="log-empty">awaiting proxy traffic…</div>';}
    else{
      logEl.innerHTML=lines.map(raw=>{
        const l=escapeHTML(raw);  // escaped first; capture groups below are \\d+/\\w+ only — safe for innerHTML
        let level='INFO';
        if(l.includes('WARNING'))level='WARNING';
        if(l.includes('UPSTREAM_ERROR')||l.includes('Error:'))level='ERROR';
        const ts=l.match(/^[\\d-]+ [\\d:,]+/)?.[0]||'';
        let msg=l.replace(ts,'').trim();
        msg=msg.replace(/tok_\\w+=(\\d+)/g,'<span class="hl">$1</span>');
        msg=msg.replace(/(\\d+)/g,'<span class="num">$1</span>');
        msg=msg.replace(/tok_\\w+=/g,'');
        return `<div class="log-line"><span class="ts">${ts}</span><span class="level ${level}">${level}</span><span class="msg">${msg}</span></div>`;
      }).join('');
      logEl.scrollTop=logEl.scrollHeight;
    }
  }catch(e){
    document.getElementById('stats').innerHTML=card('error',e.message,'red','',0,'red');
  }
}
setInterval(refresh,3000); refresh(); setInterval(refreshProgress,1500); refreshProgress();
</script>"""

HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simplicio Token Monitor</title>
<link rel="icon" href="__FAVICON__">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;700&display=swap" rel="stylesheet">
__STYLE__
</head>
<body>
__BODY__
__SCRIPT__
</body>
</html>"""


import base64 as _b64
import re as _re
_FAVICON = "data:image/svg+xml;base64," + _b64.b64encode(BADGE_SVG.encode()).decode()
# Inline the badge into BODY first (re.sub does not re-scan replacement text), then
# single-pass substitution — atomic per token, so a slot value can't expand a later slot.
BODY = BODY.replace("__BADGE__", BADGE_SVG)
_SLOTS = {"__FAVICON__": _FAVICON, "__STYLE__": STYLE, "__BODY__": BODY,
          "__SCRIPT__": SCRIPT.replace("__PROGRESS_RUN__", json.dumps(PROGRESS_RUN))}
HTML = _re.sub(r"__(?:FAVICON|STYLE|BODY|SCRIPT)__", lambda m: _SLOTS[m.group(0)], HTML)


def _read_providers():
    """Provider interceptability catalog (derived from Hermes/OpenCode provider lists)."""
    p = REPO_ROOT / "app" / "providers.json"
    if p.exists():
        try:
            d = json.loads(p.read_text(errors="replace"))
            return int(d.get("total", 0)), int(d.get("interceptable", 0))
        except (ValueError, OSError):
            pass
    return 0, 0


def _read_savings_json():
    for p in SAVINGS_JSON_CANDIDATES:
        if p.exists():
            try:
                return json.loads(p.read_text(errors="replace"))
            except (ValueError, OSError):
                pass
    return {}


def _model_family(model):
    s = (model or "").lower()
    for k, v in (("deepseek", "deepseek"), ("claude", "anthropic"), ("anthropic", "anthropic"),
                 ("gemini", "gemini"), ("gpt", "openai"), ("o1", "openai"), ("o3", "openai"),
                 ("chatgpt", "openai"), ("openai", "openai"), ("llama", "llama"),
                 ("mistral", "mistral"), ("mixtral", "mistral"), ("qwen", "qwen"),
                 ("grok", "xai"), ("xai", "xai"), ("kimi", "kimi"), ("groq", "groq")):
        if k in s:
            return v
    return "default"


def _parse_iso_epoch(iso):
    try:
        return calendar.timegm(time.strptime(iso, "%Y-%m-%dT%H:%M:%SZ"))
    except (ValueError, TypeError):
        return 0


def get_status():
    port = PROXY_PORT
    proxy_running = _port_listening(port)  # pure-Python check; no lsof/PATH dependency
    uptime = _proxy_uptime() if proxy_running else "—"

    sav = _read_savings_json()
    life = sav.get("lifetime", {}) if isinstance(sav, dict) else {}
    history = sav.get("history", []) if isinstance(sav, dict) else []

    requests = int(life.get("requests", 0) or 0)
    tok_saved = int(life.get("tokens_saved", 0) or 0)
    tok_after = int(life.get("total_input_tokens", 0) or 0)   # what actually reached the model
    tok_before = tok_after + tok_saved                          # raw, pre-compression
    usd_saved = float(life.get("compression_savings_usd", 0) or 0)
    tokens_out = int(life.get("total_output_tokens", 0) or 0)

    # Real-time series from history (each entry is one intercepted request).
    series = []
    for h in history[-48:]:
        inp = int(h.get("total_input_tokens", 0) or 0)
        sv = int(h.get("total_tokens_saved", 0) or 0)
        series.append({"before": inp + sv, "after": inp, "saved": sv, "ts": h.get("timestamp", "")})

    # Active LLM = the most recent intercepted request (provider/model/when).
    active_model = {}
    if history:
        last = history[-1]
        active_model = {
            "provider": last.get("provider", ""),
            "model": last.get("model", ""),
            "timestamp": last.get("timestamp", ""),
            "saved": int(last.get("total_tokens_saved", 0) or 0),
        }
    sess = sav.get("display_session", {}) if isinstance(sav, dict) else {}
    session = {
        "started_at": sess.get("started_at", ""),
        "last_activity_at": sess.get("last_activity_at", ""),
        "saved": int(sess.get("tokens_saved", 0) or 0),
    }

    # Models/providers actually intercepted (concrete evidence of capture).
    models_seen, seen = [], set()
    for h in reversed(history):
        key = (h.get("provider", ""), h.get("model", ""))
        if key != ("", "") and key not in seen:
            seen.add(key)
            models_seen.append({"provider": key[0], "model": key[1]})
    providers_seen = {p for p, _ in seen}

    # Fall back to log parsing if no structured savings file yet.
    text, log_source = _read_first_log()
    log_lines = []
    cache_hit, cache_count = 0.0, 0
    if text:
        lines = [ln for ln in text.strip().split("\n") if ln.strip()]
        log_lines = lines[-36:]
        if not requests:  # no JSON — derive totals from the log
            for line in lines:
                if "PERF" in line:
                    requests += 1
                    for part in line.split():
                        if part.startswith("tok_before="):
                            tok_before += _parse_int(part.split("=", 1)[1])
                        elif part.startswith("tok_after="):
                            tok_after += _parse_int(part.split("=", 1)[1])
            tok_saved = max(tok_before - tok_after, 0)
        for line in lines:
            for part in line.split():
                if part.startswith("cache_hit_pct="):
                    try:
                        cache_hit += float(part.split("=", 1)[1]); cache_count += 1
                    except ValueError:
                        pass
    cache_hit = round(cache_hit / max(cache_count, 1), 1)

    mr = _run([*ENGINE_CMD, "memory", "stats"], timeout=5)  # Simplicio capture engine
    mem = 0
    for hl in mr.stdout.split("\n"):
        if "Total Memories" in hl:
            try:
                mem = int(hl.split(":")[1].strip())
            except (IndexError, ValueError):
                pass

    # Tolerant count (#127): a truncated/illegible line is counted separately, not folded into
    # the event total as if it were real data.
    ledger = REPO_ROOT / ".simplicio-loop" / "ledger" / "savings-events.jsonl"
    if ledger.exists() and count_jsonl_lines is not None:
        lc, ledger_corrupt = count_jsonl_lines(str(ledger))
    elif ledger.exists():
        lc = sum(1 for _ in ledger.open(errors="replace"))
        ledger_corrupt = 0
    else:
        lc = ledger_corrupt = 0

    savings_pct = round((tok_saved / max(tok_before, 1)) * 100, 1)

    # Which runtimes are RUNNING right now (for the live "active / blinking" indicator).
    ps_out = _run(["ps", "-axo", "command="], timeout=3).stdout
    # Which LLM families were captured in the last 10 minutes (currently being saved).
    recent_fams = set()
    cutoff = time.time() - 600
    for h in history[-200:]:
        ts = _parse_iso_epoch(h.get("timestamp", ""))
        if ts and ts >= cutoff:
            recent_fams.add(_model_family(h.get("model", "")))

    runtimes = []
    ready = 0
    for r in RUNTIMES:
        tier = r.get("intercept", "none")
        if tier != "none":
            ready += 1
        active = bool(r.get("proc")) and re.search(r["proc"], ps_out) is not None
        capturing = active and proxy_running and bool(set(r.get("families", [])) & recent_fams)
        runtimes.append({**r, "live": proxy_running and tier != "none",
                         "active": active, "capturing": capturing})
    none_count = len(RUNTIMES) - ready
    active_count = sum(1 for r in runtimes if r["active"])
    prov_total, prov_intercept = _read_providers()

    return {
        "provider_total": prov_total,
        "provider_interceptable": prov_intercept,
        "proxy_running": proxy_running,
        "port": port,
        "uptime": uptime,
        "requests": requests,
        "tokens_before": tok_before,
        "tokens_after": tok_after,
        "tokens_saved": tok_saved,
        "usd_saved": usd_saved,
        "tokens_out": tokens_out,
        "savings_pct": savings_pct,
        "cache_hit_pct": cache_hit,
        "memories": mem,
        "ledger_events": lc,
        "ledger_corrupt_lines": ledger_corrupt,
        "series": series,
        "models_seen": models_seen[:8],
        "active_model": active_model,
        "session": session,
        "log_lines": log_lines,
        "log_source": log_source,
        "runtimes": runtimes,
        "intercept_ready": ready,
        "intercept_none": none_count,
        "active_count": active_count,
        "timestamp": time.strftime("%H:%M:%S"),
        "datetime": time.strftime("%Y-%m-%d %H:%M:%S"),
    }


def _port_listening(port):
    try:
        with socket.create_connection(("127.0.0.1", int(port)), timeout=0.6):
            return True
    except (OSError, ValueError):
        return False


def _run(cmd, timeout=5):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (FileNotFoundError, subprocess.SubprocessError):
        return subprocess.CompletedProcess(cmd, 1, "", "")


def _read_first_log():
    for log in LOG_CANDIDATES:
        if log.exists():
            text = log.read_text(errors="replace")
            if text.strip():
                return text, str(log)
    return "", ""


def _parse_int(value):
    try:
        return int(float(value))
    except ValueError:
        return 0


def _proxy_uptime():
    r = _run(["pgrep", "-f", "proxy --port"], timeout=2)  # the running capture proxy process
    pids = [pid for pid in r.stdout.strip().split("\n") if pid.strip()]
    if not pids:
        return "running"
    r2 = _run(["ps", "-o", "etime=", "-p", pids[0]], timeout=2)
    return r2.stdout.strip() or "running"


def _fallback_logo_svg():
    """No-PNG fallback — the faithful inline badge framed on black."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 224" width="240" height="224">'
        '<rect width="240" height="224" fill="#03060a"/>' + BADGE_SVG.split(">", 1)[1]
    )


def _send_logo(handler):
    for logo in LOGO_CANDIDATES:
        if logo.exists():
            handler.send_response(200)
            handler.send_header("Content-Type", "image/png")
            handler.send_header("Cache-Control", "public, max-age=3600")
            handler.end_headers()
            handler.wfile.write(logo.read_bytes())
            return
    handler.send_response(200)
    handler.send_header("Content-Type", "image/svg+xml")
    handler.send_header("Cache-Control", "public, max-age=3600")
    handler.end_headers()
    handler.wfile.write(_fallback_logo_svg().encode())


_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _progress_root():
    configured = os.environ.get("SIMPLICIO_RUNS_DIR", "")
    return Path(configured).expanduser() if configured else Path.cwd() / ".simplicio-loop/orchestrator" / "runs"


def _progress_response(run_id):
    """Return one receipt-backed progress snapshot without allowing path traversal."""
    base = _progress_root().resolve()
    if not run_id or not _RUN_ID.fullmatch(run_id):
        return 400, {"schema": "simplicio.progress/v1", "status": "UNVERIFIED",
                      "reason_code": "run_id_invalid"}
    run_dir = (base / run_id).resolve()
    try:
        run_dir.relative_to(base)
    except ValueError:
        return 400, {"schema": "simplicio.progress/v1", "status": "UNVERIFIED",
                      "reason_code": "run_id_outside_root"}
    state_path = run_dir / "state.json"
    if not state_path.is_file():
        return 404, {"schema": "simplicio.progress/v1", "status": "UNVERIFIED",
                     "run_id": run_id, "reason_code": "run_not_found"}
    try:
        from simplicio_loop.progress import build_progress
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(state, dict):
            raise ValueError("state_not_object")
        return 200, build_progress(state, run_dir=run_dir)
    except (OSError, ValueError, TypeError, ImportError, json.JSONDecodeError):
        return 422, {"schema": "simplicio.progress/v1", "status": "UNVERIFIED",
                      "run_id": run_id, "reason_code": "state_invalid"}


def _send_json(handler, status, payload):
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        if path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(json.dumps(get_status()).encode())
        elif path == "/api/progress":
            query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
            run_id = (query.get("run") or [""])[0]
            status, payload = _progress_response(run_id)
            _send_json(self, status, payload)
        elif path == "/assets/simplicio-logo.png":
            _send_logo(self)
        else:
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(HTML.encode())

    def log_message(self, format, *args):
        pass


def main():
    port = int(os.environ.get("PORT", "9090"))
    srv = http.server.HTTPServer(("127.0.0.1", port), Handler)
    try:  # the PID file lets `simplicio-loop dashboard --stop` find us; never fatal if it can't be written
        PID_FILE.parent.mkdir(parents=True, exist_ok=True)
        PID_FILE.write_text(str(os.getpid()))
    except OSError:
        pass
    print(f"⬡ Simplicio Token Monitor · http://127.0.0.1:{port}")
    print(f"   api: /api/status · refresh: 3s")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.server_close()
        if PID_FILE.exists():
            PID_FILE.unlink()


if __name__ == "__main__":
    main()
