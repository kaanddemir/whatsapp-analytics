"""Per-session storage of the uploaded chat and its computed stats.

In-memory and single-process on purpose: this is a local single-user tool, and
keeping chat exports off disk is the privacy story. Everything is lost on
restart, which is the intended behaviour.
"""

import os

from flask import session

# In-memory store of the latest parsed stats, keyed by session id.
_STATS = {}
# The same chat analysed with no filters at all. The Recap story always covers
# the whole conversation, and re-parsing a large export to answer that costs
# seconds; only a new upload or a delete can invalidate it.
_FULL_STATS = {}
# Raw uploaded text per session, so we can re-analyze on a date-range filter.
_RAW = {}
# Successful assistant exchanges per session. Questions that did not receive a
# reply are intentionally absent, so retries cannot contaminate later context.
_CHAT_HISTORY = {}
_LOCAL_CHAT_HISTORY = {}
# Explicit per-session consent for sending selected raw messages to the
# loopback model. Keeping this server-side prevents a client-only UI toggle
# from being treated as a security boundary.
_LOCAL_ANALYSIS_ENABLED = set()
# Increments whenever a transcript is cleared. In-flight AI requests capture
# the current value so their late replies cannot recreate a cleared history.
_CHAT_EPOCH = {}
# The Groq API key this browser session supplied, if any. Held here rather than
# in the session cookie so it never leaves the server, and never written to
# disk: restarting the app is what forgets it.
_GROQ_KEYS = {}
# Which model this session picked, per mode, if it picked one at all.
_LOCAL_MODELS = {}
_CLOUD_MODELS = {}


def sid():
    """Stable per-browser id, minted into the signed session cookie on first use."""
    if "sid" not in session:
        session["sid"] = os.urandom(8).hex()
    return session["sid"]


def get_stats(session_id):
    return _STATS.get(session_id)


def get_raw(session_id):
    return _RAW.get(session_id)


def get_full_stats(session_id):
    """Unfiltered stats for the Recap story, or None if not computed yet."""
    return _FULL_STATS.get(session_id)


def save_full_stats(session_id, stats):
    _FULL_STATS[session_id] = stats


def get_local_model(session_id):
    return _LOCAL_MODELS.get(session_id)


def set_local_model(session_id, model):
    _LOCAL_MODELS[session_id] = model


def get_cloud_model(session_id):
    return _CLOUD_MODELS.get(session_id)


def set_cloud_model(session_id, model):
    _CLOUD_MODELS[session_id] = model


def get_groq_key(session_id):
    return _GROQ_KEYS.get(session_id)


def set_groq_key(session_id, key):
    _GROQ_KEYS[session_id] = key


def clear_groq_key(session_id):
    _GROQ_KEYS.pop(session_id, None)


def get_chat_history(session_id):
    """Return a copy of the server-owned transcript for one browser session."""
    return list(_CHAT_HISTORY.get(session_id, ()))


def get_local_chat_history(session_id):
    """Return local-only assistant context; it is never used by Cloud mode."""
    return list(_LOCAL_CHAT_HISTORY.get(session_id, ()))


def local_analysis_enabled(session_id):
    return session_id in _LOCAL_ANALYSIS_ENABLED


def enable_local_analysis(session_id):
    _LOCAL_ANALYSIS_ENABLED.add(session_id)


def disable_local_analysis(session_id):
    """Revoke raw-message access and discard the local-only transcript."""
    _LOCAL_ANALYSIS_ENABLED.discard(session_id)
    _LOCAL_CHAT_HISTORY.pop(session_id, None)
    # Invalidate an in-flight local reply without discarding Cloud context.
    _CHAT_EPOCH[session_id] = chat_epoch(session_id) + 1


def chat_epoch(session_id):
    return _CHAT_EPOCH.get(session_id, 0)


def add_chat_exchange(session_id, user_message, assistant_reply, max_turns, expected_epoch=None):
    """Save one accepted exchange and keep only the configured recent turns."""
    if expected_epoch is not None and expected_epoch != chat_epoch(session_id):
        return False
    history = _CHAT_HISTORY.setdefault(session_id, [])
    history.extend((
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": assistant_reply},
    ))
    # max_turns is the number of messages, not question/answer pairs.
    _CHAT_HISTORY[session_id] = history[-max_turns:]
    return True


def add_local_chat_exchange(session_id, user_message, assistant_reply, max_turns, expected_epoch=None):
    """Save an accepted local-model exchange in a transcript isolated from Cloud."""
    if expected_epoch is not None and expected_epoch != chat_epoch(session_id):
        return False
    history = _LOCAL_CHAT_HISTORY.setdefault(session_id, [])
    history.extend((
        {"role": "user", "content": user_message},
        {"role": "assistant", "content": assistant_reply},
    ))
    _LOCAL_CHAT_HISTORY[session_id] = history[-max_turns:]
    return True


def clear_chat_history(session_id):
    _CHAT_HISTORY.pop(session_id, None)
    _LOCAL_CHAT_HISTORY.pop(session_id, None)
    _LOCAL_ANALYSIS_ENABLED.discard(session_id)
    _CHAT_EPOCH[session_id] = chat_epoch(session_id) + 1


def save(session_id, stats, raw=None, reset_chat=False):
    """Store `stats`; `raw` is only passed on upload, not on a re-filter."""
    _STATS[session_id] = stats
    if raw is not None:
        # A different chat invalidates the whole-conversation analysis. A
        # re-filter does not, which is why this hangs off `raw`.
        _RAW[session_id] = raw
        _FULL_STATS.pop(session_id, None)
    if reset_chat:
        clear_chat_history(session_id)


def clear(session_id):
    _STATS.pop(session_id, None)
    _FULL_STATS.pop(session_id, None)
    _RAW.pop(session_id, None)
    clear_chat_history(session_id)
