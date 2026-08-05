"""Entrypoint: `python run.py`. Ctrl+C stops it.

Flask and Werkzeug each print their own startup notes, which together read as
framework debris rather than as an application starting. They are suppressed
here and replaced with one banner: where the app is, how it is configured, and
how to stop it.
"""

import logging
import os
import socket
import sys

import flask.cli

from app import config, create_app

app = create_app()

DEFAULT_PORT = 8000


def _paint(tty):
    """Return a colouring function that is a no-op unless stdout is a terminal."""
    codes = {"bold": "1", "dim": "2", "green": "32", "yellow": "33"}

    def paint(text, *styles):
        if not tty:
            return text
        prefix = "".join(f"\033[{codes[style]}m" for style in styles)
        return f"{prefix}{text}\033[0m"

    return paint


def _quiet_framework_output():
    """Silence the two startup banners and the per-request access log.

    Werkzeug logs one line per request at INFO, which buries anything the app
    itself has to say. LOG_LEVEL=DEBUG is the way back to it.
    """
    flask.cli.show_server_banner = lambda *args, **kwargs: None
    werkzeug_logger = logging.getLogger("werkzeug")
    # The debugger prints the PIN it needs at INFO, so quieting the log there
    # would leave an opt-in feature that cannot actually be used.
    if config.LOG_LEVEL != "DEBUG" and not config.ENABLE_DEBUGGER:
        werkzeug_logger.setLevel(logging.WARNING)
    # The development-server caveat is a warning, so a level alone will not
    # hide it. It is not dropped silently: the banner states the same thing.
    werkzeug_logger.addFilter(
        lambda record: "development server" not in record.getMessage()
    )


def _assistant_line():
    """One phrase for how the AI assistant is set up before anyone opens the UI."""
    if config.GROQ_API_KEY:
        return "Cloud ready, key from .env"
    return "Cloud needs a key, add it in Settings"


def _banner(port, paint):
    url = f"http://localhost:{port}"
    rows = [
        ("Open", paint(url, "bold")),
        # No "Mode" row: which environment this is says nothing to the person
        # opening the app, and the two cases that do matter announce
        # themselves in the notes below.
        ("Assistant", _assistant_line()),
        ("Sessions", "new key each start" if config.FLASK_SECRET_GENERATED
                     else "kept across restarts"),
        ("Stop", "Ctrl+C"),
    ]
    lines = [
        "",
        f"  {paint('WhatsApp Analytics', 'bold', 'green')}",
        f"  {paint('─' * 44, 'dim')}",
    ]
    lines += [f"  {paint(label.ljust(10), 'dim')}{value}" for label, value in rows]
    # Caveats belong on screen next to the URL rather than in a log line that
    # the next request scrolls past. The debugger one is the sharpest: it is a
    # code execution path for anything that can reach the port.
    notes = []
    if config.IS_PRODUCTION:
        notes.append("Development server: single-threaded, for one local user.")
    if config.ENABLE_DEBUGGER:
        notes.append("Debugger on: the browser can execute code here.")
    if notes:
        lines.append("")
        lines += [f"  {paint('! ' + note, 'yellow')}" for note in notes]
    lines.append("")
    return "\n".join(lines)


def _port_is_free(port):
    """Whether the app can still take `port`, checked before Werkzeug does.

    Werkzeug handles this failure itself and exits with a bare "Address already
    in use", which does not say what is holding the port or what to do about
    it. Asking first is what keeps the message ours.
    """
    with socket.socket() as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _port_in_use(port, paint):
    return "\n".join((
        "",
        f"  {paint('Port ' + str(port) + ' is already in use.', 'yellow')}",
        f"  {paint('Another copy is probably still running. Stop it there with', 'dim')}",
        f"  {paint('Ctrl+C, or start this one elsewhere:', 'dim')}",
        "",
        f"      PORT={port + 1} python run.py",
        "",
    ))


def main():
    port = int(os.environ.get("PORT", DEFAULT_PORT))
    paint = _paint(sys.stdout.isatty())
    _quiet_framework_output()

    # With the reloader on, this module runs in both the supervisor and the
    # worker it restarts. The supervisor is the one that opens the socket and
    # hands the worker its file descriptor, so it is also the one that can
    # check the port and the only one that should print. A reload then replaces
    # the worker quietly instead of reprinting the whole banner.
    reloading = not config.IS_PRODUCTION
    serving = os.environ.get("WERKZEUG_RUN_MAIN") != "true"
    if serving:
        if not _port_is_free(port):
            print(_port_in_use(port, paint), flush=True)
            return 1
        # flush: a piped stdout is block-buffered, and a banner that only
        # appears once the server is stopped is worse than none.
        print(_banner(port, paint), flush=True)

    code = 0
    try:
        # The reloader tracks the environment, the debugger only its own opt-in.
        app.run(port=port, debug=config.ENABLE_DEBUGGER, use_reloader=reloading)
    except KeyboardInterrupt:
        pass
    except SystemExit as exc:
        # How the reloading supervisor ends: it exits with its worker's status
        # rather than returning. Without catching it there is no shutdown line
        # in the one mode most people run.
        code = exc.code if isinstance(exc.code, int) else 0
    if serving:
        # Every uploaded chat lived in this process, so saying so closes the
        # loop on the privacy claim the app makes while it is running.
        print(f"\n  {paint('Stopped. The uploaded chat is gone with it.', 'dim')}\n", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
