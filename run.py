"""Entrypoint: `python run.py` starts the web UI. Ctrl+C stops it.

WhatsApp Analytics runs entirely in the browser, so there is only the Vite dev
server to start. This optional wrapper reports missing setup steps or occupied ports and
stops the development server with a single Ctrl+C.
"""

import os
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent

DEFAULT_WEB_PORT = 5173
# Must match `base` in vite.config.ts, which reads the same variable.
BASE_PATH = os.environ.get("BASE_PATH", "/whatsapp-analytics/")
# How long the child gets to exit on SIGTERM before it is killed.
SHUTDOWN_GRACE = 5

# Routine `vite` lines that repeat what the banner says. Anything else
# (warnings, errors, stack traces) passes through.
VITE_NOISE = re.compile(r"^(> |VITE v|➜\s+(Local|Network|press))")
ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _paint(tty):
    """Return a colouring function that is a no-op unless stdout is a terminal."""
    codes = {"bold": "1", "dim": "2", "green": "32", "yellow": "33"}

    def paint(text, *styles):
        if not tty:
            return text
        prefix = "".join(f"\033[{codes[style]}m" for style in styles)
        return f"{prefix}{text}\033[0m"

    return paint


def _problem(paint, title, *fix):
    """Format a setup problem as the one thing to read and the command to run."""
    lines = ["", f"  {paint(title, 'yellow')}"]
    lines += [f"  {paint(line, 'dim')}" for line in fix]
    lines.append("")
    return "\n".join(lines)


def _setup_problem(paint):
    """Return the first missing piece of local setup, or None if all is present."""
    if not shutil.which("npm"):
        return _problem(
            paint,
            "npm was not found on PATH.",
            "Install Node.js 22: https://nodejs.org",
        )
    if not (ROOT / "node_modules").exists():
        return _problem(
            paint,
            "Dependencies are not installed.",
            "npm ci --ignore-scripts",
        )
    return None


def _port_is_free(port):
    """Whether the app can still take `port`, checked before the server starts.

    Vite silently moves to the next port when one is taken, which would make
    the banner's URL wrong; --strictPort plus this check keeps them in sync.
    """
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _port_in_use(paint, port):
    return "\n".join((
        "",
        f"  {paint(f'Port {port} is already in use.', 'yellow')}",
        f"  {paint('Another copy is probably still running. Stop it there with', 'dim')}",
        f"  {paint('Ctrl+C, or start this one elsewhere:', 'dim')}",
        "",
        f"      WEB_PORT={port + 1} python run.py",
        "",
    ))


def _banner(web_port, paint):
    rows = [
        ("Open", paint(f"http://localhost:{web_port}{BASE_PATH}", "bold")),
        ("Stop", "Ctrl+C"),
    ]
    lines = [
        "",
        f"  {paint('WhatsApp Analytics', 'bold', 'green')}",
        f"  {paint('─' * 44, 'dim')}",
    ]
    lines += [f"  {paint(label.ljust(10), 'dim')}{value}" for label, value in rows]
    lines.append("")
    return "\n".join(lines)


def _forward_filtered(stream):
    """Copy the child's stdout to ours, minus VITE_NOISE lines."""
    for line in iter(stream.readline, ""):
        plain = ANSI.sub("", line).strip()
        if plain and not VITE_NOISE.match(plain):
            sys.stdout.write(line)
            sys.stdout.flush()


def _accepts(port):
    """Whether something is accepting connections on `port` yet."""
    with socket.socket() as probe:
        probe.settimeout(0.2)
        return probe.connect_ex(("127.0.0.1", port)) == 0


def _start(command, cwd):
    """Start the child in its own process group, stdout filtered.

    Its own group keeps Ctrl+C from reaching it directly, so shutdown goes
    through _stop. stderr stays attached to the terminal, so errors are never
    filtered.
    """
    process = subprocess.Popen(
        command, cwd=cwd, start_new_session=True,
        stdout=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    threading.Thread(target=_forward_filtered, args=(process.stdout,), daemon=True).start()
    return process


def _terminate(signum, frame):
    """Put SIGTERM on the same shutdown path as Ctrl+C."""
    raise KeyboardInterrupt


def _stop(process):
    if process.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        return
    deadline = time.monotonic() + SHUTDOWN_GRACE
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return
        time.sleep(0.1)
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass


def main():
    paint = _paint(sys.stdout.isatty())

    problem = _setup_problem(paint)
    if problem:
        print(problem, flush=True)
        return 1

    web_port = int(os.environ.get("WEB_PORT", DEFAULT_WEB_PORT))
    if not _port_is_free(web_port):
        print(_port_in_use(paint, web_port), flush=True)
        return 1

    try:
        process = _start(
            ["npm", "run", "dev", "--", "--port", str(web_port), "--strictPort"],
            cwd=ROOT,
        )
    except OSError as exc:
        print(_problem(paint, f"Could not start the server: {exc}"), flush=True)
        return 1

    print(_banner(web_port, paint), flush=True)

    signal.signal(signal.SIGTERM, _terminate)

    code = 0
    died = False
    waiting = True
    try:
        while True:
            if process.poll() is not None:
                code = process.returncode or 1
                died = True
                raise SystemExit(code)
            if waiting and _accepts(web_port):
                waiting = False
                print(f"  {paint('✓', 'green')} Web ready", flush=True)
            time.sleep(0.2)
    except (KeyboardInterrupt, SystemExit):
        pass
    finally:
        _stop(process)

    if died:
        print(_problem(paint, "The web server stopped.", "Its error is above."), flush=True)
    else:
        print(f"\n  {paint('Stopped.', 'dim')}\n", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
