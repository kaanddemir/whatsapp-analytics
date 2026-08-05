"""WhatsApp chat export parser and statistics engine.

Parses a raw WhatsApp `.txt` export (iOS or Android format) into a single
JSON-serialisable stats object consumed by the dashboard frontend.

Layout:
    patterns.py  regexes, marker lists, stopwords
    utils.py     small pure helpers
    parsing.py   export text -> message dicts
    metrics.py   volume, timing and content metrics
    people.py    per-participant metrics and insight cards
    summary.py   text summary for the AI prompt
"""

from collections import Counter

from . import metrics, people, parsing
from .summary import summarize_for_ai

__all__ = ["analyze", "summarize_for_ai"]


def analyze(text, start=None, end=None, sender=None):
    """Parse `text` and return the full stats dict for the dashboard.

    `start`/`end` are optional inclusive ISO dates (YYYY-MM-DD) that filter the
    messages to a date range before computing stats.

    `sender` optionally narrows the volume stats (totals, timing, emojis,
    keywords) to one participant. Interaction stats that only make sense across
    two people — reply speed, message balance, who starts conversations — stay
    computed on the whole conversation.
    """
    real = parsing.real_messages(parsing.parse_messages(text))

    if not real:
        raise ValueError("No parseable WhatsApp messages found in this file.")

    # The picker keeps full chat bounds after filtering.
    full_start = real[0]["dt"].date()
    full_end = real[-1]["dt"].date()

    real = parsing.filter_range(real, start, end)
    if not real:
        raise ValueError("No messages found in the selected date range.")

    # Conversation-wide volume metrics remain meaningful under participant
    # filters. Meta AI is retained for those metrics, but is not a human
    # participant for Message Balance or person-to-person interaction metrics.
    convo = real
    senders = Counter(m["sender"] for m in convo)
    participant_convo = [
        message for message in convo
        if not parsing.is_meta_ai_sender(message["sender"])
    ]
    participant_senders = Counter(m["sender"] for m in participant_convo)
    is_group = len(participant_senders) > 2
    convo_total = len(convo)

    if sender:
        if sender not in senders:
            raise ValueError("That participant is not in this chat.")
        real = [m for m in real if m["sender"] == sender]
        if not real:
            raise ValueError("No messages from that participant in this range.")

    kpis = metrics.kpis(real)
    over_time = metrics.over_time(real)
    weekday_avgs = metrics.weekday_avgs(real)
    hours, peak_hour, peak_hour_share = metrics.hours(real)
    heatmap = metrics.heatmap(real)

    reply_speeds = people.reply_speed(participant_convo)
    top_emojis, emoji_summary = metrics.emojis(real)
    top_keywords, media_breakdown, keyword_summary = metrics.keywords(real)

    participants = people.participants(participant_senders, reply_speeds)
    starter = people.conversation_starter_details(participant_convo)
    insights = people.insights(
        real,
        hours,
        peak_hour,
        weekday_avgs,
        participants,
        starter,
        people.night_owl(participant_convo, participant_senders),
    )
    insights.update({"convo_total": convo_total, "is_group": is_group})

    return {
        "meta": {
            "is_group": is_group,
            "participants": list(participant_senders.keys()),
            "active_sender": sender,
            "date_range": {
                "start": convo[0]["dt"].strftime("%b %d, %Y"),
                "end": convo[-1]["dt"].strftime("%b %d, %Y"),
            },
            "full_range": {
                "start": full_start.isoformat(),
                "end": full_end.isoformat(),
            },
            "range_iso": {
                "start": convo[0]["dt"].date().isoformat(),
                "end": convo[-1]["dt"].date().isoformat(),
            },
        },
        "kpis": {
            **kpis,
            **metrics.volume(real),
            "peak_hour": f"{peak_hour:02d}:00",
            "peak_hour_share": peak_hour_share,
        },
        "messages_over_time": over_time,
        "hours": hours,
        "heatmap": heatmap,
        "top_emojis": top_emojis,
        "top_keywords": top_keywords,
        "media": media_breakdown,
        "content_summary": {
            "emojis": emoji_summary,
            "keywords": keyword_summary,
        },
        "insights": insights,
    }
