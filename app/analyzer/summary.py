"""Bounded aggregate-statistics rendering for the AI system prompt."""

import json

from .. import config


def _short_text(value, limit=120):
    """Keep source-controlled labels compact and single-line for AI context."""
    text = " ".join(str(value or "").split())
    return text[:limit]


def _item_list(items, label, limit=8):
    """Render ranking entries without allowing their labels to grow unbounded."""
    return [
        {"label": _short_text(item.get(label)), "count": item.get("count", 0)}
        for item in items[:limit]
    ]


def _fit(summary, max_chars):
    """Shrink the ranking sections until the encoded summary fits `max_chars`.

    Slicing the encoded string instead would leave the caller holding a JSON
    fragment. Local mode parses this back with `json.loads`, so a mid-object
    cut is not a shorter prompt — it is a 500.
    """
    def encode():
        text = json.dumps(summary, ensure_ascii=False, separators=(",", ":"))
        return text.replace("<", "\\u003c").replace(">", "\\u003e")

    trimmable = ("top_keywords", "top_emojis", "participants_metrics", "participants")
    encoded = encode()
    while len(encoded) > max_chars:
        longest = max(trimmable, key=lambda key: len(summary[key]))
        if not summary[longest]:
            # Every ranking is empty and the fixed fields alone are too long.
            # Report the shape honestly rather than a truncated one.
            break
        summary[longest] = summary[longest][:-1]
        encoded = encode()
    return encoded


def summarize_for_ai(stats, max_chars=None):
    """Serialize only bounded aggregates, never raw WhatsApp message content.

    JSON gives the model a stable data shape. Escaping angle brackets prevents
    source-controlled names or keywords from terminating the prompt delimiter.
    The result is always valid JSON, whatever the limit.
    """
    max_chars = max_chars or config.AI_MAX_CONTEXT_CHARS
    k = stats["kpis"]
    ins = stats["insights"]
    meta = stats["meta"]
    summary = {
        "chat_type": "group" if meta["is_group"] else "direct",
        "participants": [_short_text(name) for name in meta["participants"][:6]],
        "participant_count": len(meta["participants"]),
        "selected_participant": _short_text(meta.get("active_sender")) or None,
        "date_range": meta["date_range"],
        "totals": {
            "messages": k["total_messages"],
            "active_days": k["active_days"],
            "messages_per_active_day": k["msgs_per_day"],
            "peak_hour": k["peak_hour"],
            "peak_hour_share_percent": k["peak_hour_share"],
        },
        "activity": {
            "busiest_weekday": _short_text(ins["busiest_day"]),
            "most_active_window": _short_text(ins["most_active_time"]),
            "longest_streak_days": ins["longest_streak_days"],
            "longest_streak_range": _short_text(ins["longest_streak_range"]),
        },
        "participants_metrics": [
            {
                "name": _short_text(person["name"]),
                "messages": person["count"],
                "message_share_percent": person["pct"],
                "average_reply_time": _short_text(person["avg_response_label"]),
            }
            for person in ins["participants"][:8]
        ],
        "conversation_starter": {
            "name": _short_text(ins["conversation_starter"]),
            "share_percent": ins["conversation_starter_pct"],
        },
        "night_owl": {
            "name": _short_text(ins["night_owl"]),
            "share_percent": ins["night_owl_share"],
            "hours": "00:00-05:00",
        },
        "top_emojis": _item_list(stats["top_emojis"], "emoji"),
        # These are word frequencies, not validated semantic topics.
        "top_keywords": _item_list(stats["top_keywords"], "word"),
    }
    return _fit(summary, max_chars)
