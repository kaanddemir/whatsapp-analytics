"""Upload, read, filter and forget the analysed chat."""

from flask import Blueprint, current_app, jsonify, request

from .. import config
from ..analyzer import analyze
from ..services import groq_client, store

bp = Blueprint("api", __name__, url_prefix="/api")


@bp.route("/stats")
def get_stats():
    stats = store.get_stats(store.sid())
    if not stats:
        return jsonify({"loaded": False})
    return jsonify({"loaded": True, "stats": stats})


@bp.route("/settings/groq-key", methods=["GET"])
def groq_key_status():
    """Report whether Cloud mode has a key, never what the key is."""
    sid = store.sid()
    if store.get_groq_key(sid):
        return jsonify({"configured": True, "source": "session"})
    if config.GROQ_API_KEY:
        return jsonify({"configured": True, "source": "env"})
    return jsonify({"configured": False, "source": None})


@bp.route("/settings/groq-key", methods=["POST"])
def save_groq_key():
    """Store a session key, but only one Groq has actually accepted.

    Verifying first means a bad paste is reported here, at the field the user
    is looking at, instead of surfacing later as a failed question.
    """
    body = request.get_json(silent=True)
    key = (body or {}).get("key")
    key = key.strip() if isinstance(key, str) else ""
    if not key:
        return jsonify({"error": "Enter an API key.", "reason": "invalid_key"}), 400
    try:
        groq_client.verify_key(key)
    except groq_client.GroqError as exc:
        return jsonify({"error": exc.message, "reason": exc.reason}), exc.status

    store.set_groq_key(store.sid(), key)
    return jsonify({"configured": True, "source": "session"})


@bp.route("/settings/groq-key", methods=["DELETE"])
def delete_groq_key():
    """Drop this session's key and fall back to the server's, if it has one."""
    store.clear_groq_key(store.sid())
    return jsonify({
        "configured": bool(config.GROQ_API_KEY),
        "source": "env" if config.GROQ_API_KEY else None,
    })


@bp.route("/upload", methods=["POST"])
def upload():
    file = request.files.get("file")
    if not file or file.filename == "":
        return jsonify({"error": "No file provided."}), 400
    if not file.filename.lower().endswith(".txt"):
        return jsonify({
            "error": "Please upload a WhatsApp chat export in .txt format so we can analyze your conversation."
        }), 400

    try:
        raw = file.read().decode("utf-8", errors="ignore")
        stats = analyze(raw)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        # The user-facing message stays generic, but an unexpected parse
        # failure is a bug and has to be findable in the log.
        current_app.logger.exception("Upload analysis failed")
        return jsonify({"error": "Could not parse this file."}), 400

    sid = store.sid()
    store.save(sid, stats, raw, reset_chat=True)
    # An upload is analysed with no filters, which is exactly what the Recap
    # story needs. Keeping it spares that route a second full parse.
    store.save_full_stats(sid, stats)
    return jsonify({"loaded": True, "stats": stats})


@bp.route("/range", methods=["POST"])
def filter_range():
    """Re-analyze the uploaded chat for a date range and/or one participant.

    Empty values mean no filter: the full range, everyone.
    """
    sid = store.sid()
    raw = store.get_raw(sid)
    if not raw:
        return jsonify({"error": "No chat uploaded yet."}), 400

    body = request.get_json(force=True, silent=True) or {}
    start = (body.get("start") or "").strip() or None
    end = (body.get("end") or "").strip() or None
    sender = (body.get("sender") or "").strip() or None
    try:
        stats = analyze(raw, start=start, end=end, sender=sender)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        current_app.logger.exception("Range filter failed")
        return jsonify({"error": "Could not apply the filter."}), 400

    store.save(sid, stats, reset_chat=True)
    return jsonify({"loaded": True, "stats": stats})


@bp.route("/recap")
def recap():
    """Whole-chat stats for the recap story, ignoring the active filters.

    Deliberately does not touch the active selection: the dashboard's own
    filter and the assistant's transcript both have to survive opening the
    story, which is exactly what re-using /range would break.
    """
    sid = store.sid()
    cached = store.get_full_stats(sid)
    if cached:
        return jsonify({"stats": cached})

    raw = store.get_raw(sid)
    if not raw:
        return jsonify({"error": "No chat uploaded yet."}), 400
    try:
        stats = analyze(raw)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception:
        current_app.logger.exception("Recap analysis failed")
        return jsonify({"error": "Could not build the recap."}), 400
    store.save_full_stats(sid, stats)
    return jsonify({"stats": stats})


@bp.route("/reset", methods=["POST"])
def reset():
    """Forget the uploaded chat for this session (Settings → Data & Privacy)."""
    # The Groq key is intentionally NOT cleared: deleting a chat should not mean
    # typing the key in again. Settings → AI Provider → Remove key does that.
    store.clear(store.sid())
    return jsonify({"loaded": False})
