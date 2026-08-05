"""All environment-derived settings, read once at import time."""

import os
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv()


def _positive_int(name, default):
    """Read a strictly positive integer setting with a useful startup error."""
    raw = os.environ.get(name, str(default))
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a positive integer.") from exc
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer.")
    return value


def _temperature(name, default):
    """Read an OpenAI-compatible temperature in its supported range."""
    raw = os.environ.get(name, str(default))
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number between 0 and 2.") from exc
    if not 0 <= value <= 2:
        raise ValueError(f"{name} must be a number between 0 and 2.")
    return value


def _flag(name, default=False):
    """Read an opt-in boolean setting, accepting the usual written forms."""
    raw = os.environ.get(name)
    if raw is None or not raw.strip():
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{name} must be a boolean (1/0, true/false, yes/no, on/off).")


def _choice(name, default, allowed):
    """Read an enumerated provider setting and reject unsupported values early."""
    value = os.environ.get(name, default)
    if value not in allowed:
        choices = ", ".join(sorted(allowed))
        raise ValueError(f"{name} must be one of: {choices}.")
    return value


def _local_url(name, default):
    """Accept only a loopback model endpoint (raw chats must stay local)."""
    value = os.environ.get(name, default).rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError(f"{name} must be an http URL on localhost or 127.0.0.1.")
    return value


APP_ENV = _choice("APP_ENV", "development", {"development", "production"})
IS_PRODUCTION = APP_ENV == "production"
LOG_LEVEL = _choice(
    "LOG_LEVEL", "INFO", {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
)

# The placeholders this repository has shipped. None of them may reach a
# production session cookie, and recognising them by name is what turns a
# copied-and-not-edited .env into a startup error rather than a forgeable
# session.
_PLACEHOLDER_SECRETS = {"dev-secret-change-me", "change-me-to-a-random-string"}


def _secret(name):
    """Return ``(key, generated)``: the configured session key, or a random one.

    The session cookie is what keys a browser to its uploaded chat, so a
    committed default would be a key anyone could forge with. Generating one
    per process instead means an unconfigured run is still safe; the only cost
    is that a restart forgets sessions, which is already true of the in-memory
    chat they point at.

    Failing on a known placeholder in production is deliberate: a silently
    insecure server is worse than one that does not start.
    """
    value = os.environ.get(name, "").strip()
    if value in _PLACEHOLDER_SECRETS:
        if IS_PRODUCTION:
            raise ValueError(
                f"{name} is still set to a placeholder. Set it to a random "
                "value when APP_ENV=production."
            )
        # A placeholder is a key printed in this repository, so honouring one
        # in development would be worse than having none. Treat it as unset;
        # the startup banner is where that shows up, since a log line here
        # would print before logging is even configured.
        value = ""
    return value or os.urandom(32).hex(), not value


FLASK_SECRET, FLASK_SECRET_GENERATED = _secret("FLASK_SECRET")
# Werkzeug's interactive debugger executes code submitted through the browser,
# so it is opt-in rather than a consequence of running in development. The
# reloader is not: it is a convenience with no such reach.
ENABLE_DEBUGGER = _flag("ENABLE_DEBUGGER")
if ENABLE_DEBUGGER and IS_PRODUCTION:
    raise ValueError("ENABLE_DEBUGGER cannot be set when APP_ENV=production.")
MAX_CONTENT_LENGTH = 25 * 1024 * 1024  # 25 MB upload cap
# Sessions only key a browser to its in-memory chat; a long life buys nothing.
SESSION_LIFETIME_DAYS = _positive_int("SESSION_LIFETIME_DAYS", 7)

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODELS_URL = "https://api.groq.com/openai/v1/models"
# Small and fast, which is the right trade for questions answered from a
# bounded statistics summary rather than from reasoning over raw text.
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")
# Which of Groq's chat models the picker offers, in the order it lists them.
# Groq serves a couple of dozen; these are the ones worth pointing at a short,
# statistics-grounded question. Set to an empty string to offer every chat
# model Groq serves for the key instead.
GROQ_MODELS = tuple(
    name.strip() for name in os.environ.get(
        "GROQ_MODELS",
        "llama-3.1-8b-instant,llama-3.3-70b-versatile,"
        "openai/gpt-oss-20b,openai/gpt-oss-120b",
    ).split(",") if name.strip()
)
# GPT-OSS spends part of this budget on hidden reasoning before it writes
# anything visible, so a 300-token cap regularly truncated short answers.
GROQ_MAX_TOKENS = _positive_int("GROQ_MAX_TOKENS", 800)
GROQ_TIMEOUT = _positive_int("GROQ_TIMEOUT", 30)
GROQ_TEMPERATURE = _temperature("GROQ_TEMPERATURE", 0.2)
# GPT-OSS supports low/medium/high reasoning effort. Low is sufficient for
# short, bounded aggregate-statistics questions and keeps response cost down.
GROQ_REASONING_EFFORT = _choice("GROQ_REASONING_EFFORT", "low", {"low", "medium", "high"})
GROQ_REASONING_FORMAT = _choice("GROQ_REASONING_FORMAT", "hidden", {"hidden", "raw", "parsed"})

# Per-session burst cap: max AI requests in any rolling 60s window. There is no
# daily cap — each user brings their own API key and pays for their own usage.
AI_RATE_PER_MIN = _positive_int("AI_RATE_PER_MIN", 10)
# Reject over-long prompts (bounds input token cost / abuse).
AI_MAX_MESSAGE_CHARS = _positive_int("AI_MAX_MESSAGE_CHARS", 2000)
# Bound the aggregate-statistics context and retained server-side transcript.
AI_MAX_CONTEXT_CHARS = _positive_int("AI_MAX_CONTEXT_CHARS", 4000)
AI_HISTORY_TURNS = _positive_int("AI_HISTORY_TURNS", 6)

# Local message analysis talks only to a loopback OpenAI-compatible server.
# It deliberately cannot be configured to a remote URL: that restriction is the
# privacy boundary, and only the port is free to vary.
LOCAL_LLM_PROVIDER = _choice(
    "LOCAL_LLM_PROVIDER", "auto", {"auto", "lmstudio", "ollama"}
)
# "auto" tries these in order and uses whichever answers first.
LOCAL_PROVIDER_URLS = {
    "lmstudio": "http://127.0.0.1:1234/v1",
    "ollama": "http://127.0.0.1:11434/v1",
}
# Set explicitly to pin one endpoint; otherwise the provider decides.
LOCAL_LLM_BASE_URL = (
    _local_url("LOCAL_LLM_BASE_URL", LOCAL_PROVIDER_URLS["lmstudio"])
    if os.environ.get("LOCAL_LLM_BASE_URL") else None
)
# Optional: with no model configured, the user picks one from what is loaded.
LOCAL_LLM_MODEL = os.environ.get("LOCAL_LLM_MODEL", "")
LOCAL_LLM_TEMPERATURE = _temperature("LOCAL_LLM_TEMPERATURE", 0.2)
LOCAL_LLM_MAX_MESSAGES = _positive_int("LOCAL_LLM_MAX_MESSAGES", 50)
LOCAL_LLM_MAX_MESSAGE_CHARS = _positive_int("LOCAL_LLM_MAX_MESSAGE_CHARS", 300)
LOCAL_LLM_MAX_TOKENS = _positive_int("LOCAL_LLM_MAX_TOKENS", 500)
LOCAL_LLM_TIMEOUT = _positive_int("LOCAL_LLM_TIMEOUT", 60)
# Gemma 4 otherwise spends the completion budget on hidden reasoning in LM
# Studio, sometimes yielding an empty visible response.
LOCAL_LLM_REASONING_EFFORT = _choice("LOCAL_LLM_REASONING_EFFORT", "none", {"none", "low", "medium", "high"})
