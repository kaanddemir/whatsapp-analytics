"""The AI assistant endpoint: validate, meter, then proxy to Groq."""

from flask import Blueprint, jsonify, request

from .. import config
from ..analyzer import parsing
from ..services import groq_client, local_client, quota, store

bp = Blueprint("chat", __name__, url_prefix="/api")


def resolve_groq_key(sid):
    """This session's own key, else whatever the server was started with.

    Letting the session win is what makes the app distributable: a copy running
    with no key at all is fully usable as soon as someone pastes theirs in.
    """
    return store.get_groq_key(sid) or config.GROQ_API_KEY or None


_TURKISH_HINTS = {
    "merhaba", "selam", "lütfen", "lutfen", "analiz", "istatistik", "sohbet", "mesaj",
    "katılımcı", "katilimci", "anahtar", "emoji", "karşılaştır", "karsilastir", "yardım",
    "yardim", "nasıl", "nasil", "neden", "nedir", "ne", "mi", "mı", "yükle", "yukle",
}


def _no_data_reply(user_message):
    """Return a local upload instruction without spending an AI request."""
    words = set(user_message.lower().replace("?", " ").replace("!", " ").split())
    is_turkish = bool(words & _TURKISH_HINTS) or any(char in user_message.lower() for char in "çğıöşü")
    if is_turkish:
        return (
            "Analiz yapabilmem için lütfen bir WhatsApp .txt dışa aktarım dosyası yükleyin. "
            "Dosya yüklendikten sonra etkinlik, katılımcılar, zamanlama, anahtar kelimeler "
            "ve emojiler hakkında yardımcı olabilirim."
        )
    return (
        "Please upload a WhatsApp .txt export before asking analytics questions. "
        "I can then help with activity, participants, timing, keywords, and emojis."
    )


def _message_from_request():
    """Validate the shared, intentionally tiny assistant request contract."""
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return None, None, (jsonify({"error": "Request body must be a JSON object.", "reason": "invalid_request"}), 400)
    user_message = body.get("message")
    if not isinstance(user_message, str):
        return None, None, (jsonify({"error": "Message must be a string.", "reason": "invalid_message"}), 400)
    user_message = user_message.strip()
    if not user_message:
        return None, None, (jsonify({"error": "Empty message.", "reason": "empty_message"}), 400)
    if len(user_message) > config.AI_MAX_MESSAGE_CHARS:
        return None, None, (jsonify({
            "error": f"Message too long (max {config.AI_MAX_MESSAGE_CHARS} characters).",
            "reason": "too_long",
        }), 400)
    response_language = body.get("response_language")
    if response_language not in {None, "English"}:
        return None, None, (jsonify({
            "error": "Unsupported response language hint.",
            "reason": "invalid_language",
        }), 400)
    return user_message, response_language, None


def _selected_messages(raw, stats):
    """Rebuild the current dashboard scope for local-only text analysis."""
    meta = stats.get("meta", {})
    bounds = meta.get("range_iso", {})
    messages = parsing.real_messages(parsing.parse_messages(raw))
    messages = parsing.filter_range(messages, bounds.get("start"), bounds.get("end"))
    active_sender = meta.get("active_sender")
    if active_sender:
        messages = [message for message in messages if message["sender"] == active_sender]
    return messages


@bp.route("/chat/reset", methods=["POST"])
def reset_chat_history():
    """Forget only the assistant transcript; keep the uploaded stats."""
    store.clear_chat_history(store.sid())
    return jsonify({"cleared": True})


@bp.route("/chat/cloud/models")
def cloud_models():
    """Report what Groq actually serves for this key, rather than assuming.

    The configured `GROQ_MODEL` is only a preference: models get renamed and
    retired upstream, and a stale name should surface here instead of as a
    failed question later.
    """
    sid = store.sid()
    api_key = resolve_groq_key(sid)
    if not api_key:
        return jsonify({
            "error": "Add your Groq API key in Settings → AI Provider first.",
            "reason": "not_configured",
        }), 503
    try:
        models = groq_client.list_models(api_key)
    except groq_client.GroqError as exc:
        return jsonify({"error": exc.message, "reason": exc.reason}), exc.status
    return jsonify({
        "models": models,
        "selected": groq_client.resolve_model(models, store.get_cloud_model(sid)),
    })


@bp.route("/chat/cloud/model", methods=["POST"])
def select_cloud_model():
    """Remember which Groq model this session wants to use."""
    sid = store.sid()
    body = request.get_json(silent=True) or {}
    model = body.get("model")
    if not isinstance(model, str) or not model.strip():
        return jsonify({"error": "Choose a model.", "reason": "invalid_model"}), 400
    api_key = resolve_groq_key(sid)
    if not api_key:
        return jsonify({
            "error": "Add your Groq API key in Settings → AI Provider first.",
            "reason": "not_configured",
        }), 503
    try:
        models = groq_client.list_models(api_key)
    except groq_client.GroqError as exc:
        return jsonify({"error": exc.message, "reason": exc.reason}), exc.status
    if model not in models:
        return jsonify({
            "error": "Groq does not serve that model for this key.",
            "reason": "invalid_model",
        }), 400
    store.set_cloud_model(sid, model)
    return jsonify({"selected": model})


@bp.route("/chat/local/models")
def local_models():
    """Report what is loaded locally, so the user picks instead of typing an id."""
    sid = store.sid()
    try:
        provider, _, models = local_client.discover(force=True)
    except local_client.LocalModelError as exc:
        return jsonify({"error": exc.message, "reason": exc.reason}), exc.status
    return jsonify({
        "provider": provider,
        "models": models,
        "selected": local_client.resolve_model(models, store.get_local_model(sid)),
    })


@bp.route("/chat/local/model", methods=["POST"])
def select_local_model():
    """Remember which loaded model this session wants to use."""
    body = request.get_json(silent=True) or {}
    model = body.get("model")
    if not isinstance(model, str) or not model.strip():
        return jsonify({"error": "Choose a model.", "reason": "invalid_model"}), 400
    try:
        _, _, models = local_client.discover(force=True)
    except local_client.LocalModelError as exc:
        return jsonify({"error": exc.message, "reason": exc.reason}), exc.status
    if model not in models:
        return jsonify({
            "error": "That model is not loaded right now.",
            "reason": "invalid_model",
        }), 400
    store.set_local_model(store.sid(), model)
    return jsonify({"selected": model})


@bp.route("/chat/local/enable", methods=["POST"])
def enable_local_analysis():
    """Check only the loopback local server before local text is used."""
    sid = store.sid()
    try:
        provider, _, models = local_client.discover()
    except local_client.LocalModelError as exc:
        return jsonify({"error": exc.message, "reason": exc.reason}), exc.status
    store.enable_local_analysis(sid)
    return jsonify({
        "enabled": True,
        "provider": provider,
        "model": local_client.resolve_model(models, store.get_local_model(sid)),
    })


@bp.route("/chat/local", methods=["POST"])
def local_chat():
    """Use local stats, and raw excerpts only after the extra consent toggle."""
    sid = store.sid()
    user_message, response_language, error = _message_from_request()
    if error:
        return error
    stats, raw = store.get_stats(sid), store.get_raw(sid)
    if not stats:
        return jsonify({
            "error": "Upload a WhatsApp export before using local message analysis.",
            "reason": "no_data",
        }), 400
    try:
        local_client.verify_available()
        selected_messages = _selected_messages(raw, stats) if store.local_analysis_enabled(sid) and raw else []
        messages = local_client.build_messages(
            selected_messages,
            stats,
            store.get_local_chat_history(sid),
            user_message,
            response_language=response_language,
        )
        conversation_epoch = store.chat_epoch(sid)
        reply = local_client.ask(messages, store.get_local_model(sid))
    except local_client.LocalModelError as exc:
        return jsonify({"error": exc.message, "reason": exc.reason}), exc.status
    store.add_local_chat_exchange(
        sid, user_message, reply, config.AI_HISTORY_TURNS, expected_epoch=conversation_epoch
    )
    return jsonify({"reply": reply, "mode": "local"})


@bp.route("/chat/local/disable", methods=["POST"])
def disable_local_analysis():
    """Stop sending raw messages to the local server and erase what they fed."""
    store.disable_local_analysis(store.sid())
    return jsonify({"enabled": False})


@bp.route("/chat", methods=["POST"])
def chat():
    sid = store.sid()
    user_message, response_language, error = _message_from_request()
    if error:
        return error

    # There is no chat data to analyse, so do not make an upstream request or
    # spend a rate-limit slot just to ask for an upload.
    if not store.get_stats(sid):
        return jsonify({"reply": _no_data_reply(user_message), "reason": "no_data"})

    api_key = resolve_groq_key(sid)
    if not api_key:
        return jsonify({
            "error": "Add your Groq API key in Settings → AI Provider to use Cloud mode.",
            "reason": "not_configured",
        }), 503

    # Burst rate limit (rolling 60s window). There is no daily cap: the key is
    # the user's own, so Groq already meters what it costs them.
    if not quota.rate_ok(sid):
        return jsonify({
            "error": "Too many requests. Please wait a moment.",
            "reason": "rate_limit",
        }), 429

    # The old client-provided `history` field is intentionally ignored. The
    # transcript is server-owned so a browser cannot forge assistant context.
    conversation_epoch = store.chat_epoch(sid)
    messages = groq_client.build_messages(
        store.get_stats(sid), store.get_chat_history(sid), user_message,
        response_language=response_language,
    )
    try:
        reply = groq_client.ask(messages, api_key, store.get_cloud_model(sid))
    except groq_client.GroqError as exc:
        return jsonify({"error": exc.message, "reason": exc.reason}), exc.status

    store.add_chat_exchange(
        sid, user_message, reply, config.AI_HISTORY_TURNS, expected_epoch=conversation_epoch
    )
    return jsonify({"reply": reply})
