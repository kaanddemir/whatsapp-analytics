"""Volume, timing and content metrics computed over a list of messages.

Every function here takes the chronologically sorted message list produced by
`parsing.real_messages` and returns plain JSON-serialisable data.
"""

import calendar
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

from .patterns import EMOJI_RE, MEDIA_RE, SKIN_TONE_RE, STOPWORDS, URL_RE, WORD_RE
from .utils import fold_stretch, is_mash, lower_tr, media_kind


# ---- bucket helpers ------------------------------------------------------
def month_keys(first, last):
    """Every "YYYY-MM" from `first` to `last` inclusive, silent months included."""
    keys, y, mo = [], first.year, first.month
    while (y, mo) <= (last.year, last.month):
        keys.append(f"{y:04d}-{mo:02d}")
        y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)
    return keys


def partial_flags(bounds, span_start, span_end):
    """Flag buckets the range only partly covers, so the chart can dash them.

    The first and last bucket of a range are usually cut short, and half a month
    of messages plotted next to full ones reads as a collapse in activity.
    """
    return [span_start > lo or span_end < hi for lo, hi in bounds]


def month_bounds(key):
    y, mo = int(key[:4]), int(key[5:])
    return date(y, mo, 1), date(y, mo, calendar.monthrange(y, mo)[1])


def week_starts(span_start, span_end):
    """Every Monday-anchored week touching the range, first to last."""
    weeks, w = [], span_start - timedelta(days=span_start.weekday())
    while w <= span_end:
        weeks.append(w)
        w += timedelta(days=7)
    return weeks


def grain_for(span_days):
    """Coarsest-to-finest pick that keeps the line readable at ~700px wide.

    Daily tops out near 90 points before days stop being distinguishable, and
    weekly runs out around six months; past that only monthly stays legible.
    """
    if span_days <= 90:
        return "daily"
    if span_days <= 180:
        return "weekly"
    return "monthly"


# ---- volume and timing ---------------------------------------------------
def kpis(messages):
    active_days = {msg["dt"].date() for msg in messages}
    monthly = defaultdict(int)
    active_days_by_month = defaultdict(set)
    for msg in messages:
        key = msg["dt"].strftime("%Y-%m")
        monthly[key] += 1
        active_days_by_month[key].add(msg["dt"].date())

    keys = month_keys(messages[0]["dt"].date(), messages[-1]["dt"].date())
    active_days_series = [len(active_days_by_month.get(key, ())) for key in keys]
    return {
        "total_messages": len(messages),
        "active_days": len(active_days),
        "active_days_series": active_days_series,
        "msgs_per_day": round(len(messages) / len(active_days), 1) if active_days else 0,
        "msgs_per_day_series": [
            round(monthly.get(key, 0) / days, 1) if days else 0
            for key, days in zip(keys, active_days_series)
        ],
    }


def volume(messages):
    """How much was actually typed: words written and the average per message.

    Media placeholders are counted as messages everywhere else, but they carry
    no words of their own, so counting them here would drag the average down
    towards zero for a chat that mostly trades photos.
    """
    words = 0
    typed = 0
    for msg in messages:
        if MEDIA_RE.match(msg["text"].strip().lower()):
            continue
        count = len(msg["text"].split())
        if not count:
            continue
        words += count
        typed += 1
    return {
        "total_words": words,
        "words_per_message": round(words / typed, 1) if typed else 0,
    }


def over_time(messages):
    span_start, span_end = messages[0]["dt"].date(), messages[-1]["dt"].date()
    monthly, weekly, daily = defaultdict(int), defaultdict(int), defaultdict(int)
    for msg in messages:
        day = msg["dt"].date()
        monthly[msg["dt"].strftime("%Y-%m")] += 1
        weekly[day - timedelta(days=day.weekday())] += 1
        daily[day] += 1

    keys = month_keys(span_start, span_end)
    week_keys = week_starts(span_start, span_end)
    day_keys = [span_start + timedelta(days=offset)
                for offset in range((span_end - span_start).days + 1)]
    return {
        "grain": grain_for((span_end - span_start).days + 1),
        "monthly": {
            "labels": [datetime.strptime(key, "%Y-%m").strftime("%b %Y") for key in keys],
            "values": [monthly.get(key, 0) for key in keys],
            "partial": partial_flags(
                [month_bounds(key) for key in keys], span_start, span_end),
        },
        "weekly": {
            "labels": [week.strftime("%b %d, %Y") for week in week_keys],
            "values": [weekly.get(week, 0) for week in week_keys],
            "partial": partial_flags(
                [(week, week + timedelta(days=6)) for week in week_keys],
                span_start, span_end),
        },
        "daily": {
            "labels": [day.strftime("%b %d, %Y") for day in day_keys],
            "values": [daily.get(day, 0) for day in day_keys],
            "partial": [False] * len(day_keys),
        },
    }


def weekday_avgs(messages):
    start, end = messages[0]["dt"].date(), messages[-1]["dt"].date()
    totals, occurrences = [0] * 7, [0] * 7
    for msg in messages:
        totals[msg["dt"].weekday()] += 1
    for offset in range((end - start).days + 1):
        occurrences[(start + timedelta(days=offset)).weekday()] += 1
    return [round(totals[index] / occurrences[index], 1) if occurrences[index] else 0
            for index in range(7)]


def hours(messages):
    """Per-hour totals plus the peak hour and its share of all messages."""
    counts = [0] * 24
    for msg in messages:
        counts[msg["dt"].hour] += 1
    peak_hour = max(range(24), key=lambda hour: counts[hour])
    return counts, peak_hour, round(counts[peak_hour] / len(messages) * 100, 1)


def heatmap(messages):
    grid = [[0] * 24 for _ in range(7)]
    for msg in messages:
        grid[msg["dt"].weekday()][msg["dt"].hour] += 1
    return grid


# ---- content -------------------------------------------------------------
TOP_CONTENT_LIMIT = 10


def emojis(messages):
    """Top emoji ranking plus the totals behind it, from one scan.

    The ranking and its summary line used to run the emoji regex over every
    message twice; on a long export that pass is the expensive part.
    """
    counts = Counter()
    uses = 0
    message_count = 0
    for msg in messages:
        found = [SKIN_TONE_RE.sub("", emoji) for emoji in EMOJI_RE.findall(msg["text"])]
        counts.update(found)
        uses += len(found)
        message_count += bool(found)
    return (
        [{"emoji": emoji, "count": count}
         for emoji, count in counts.most_common(TOP_CONTENT_LIMIT)],
        {"uses": uses, "message_count": message_count},
    )


def keywords(messages):
    """Top words, the media breakdown and the keyword totals, from one scan.

    Tokenising is the most expensive thing done per message, so all three
    outputs share the single pass rather than each taking their own.
    """
    words, media = Counter(), Counter()
    for msg in messages:
        plain = msg["text"].lower().replace("̇", "")
        if MEDIA_RE.match(plain.strip()):
            # Deleted-message placeholders are not media and should not inflate
            # the Media Breakdown. They still remain messages in volume metrics.
            kind = media_kind(plain)
            if kind != "Deleted":
                media[kind] += 1
            continue
        for word in WORD_RE.findall(URL_RE.sub(" ", lower_tr(msg["text"]))):
            word = fold_stretch(word.split("'")[0])
            if len(word) > 1 and word not in STOPWORDS and not is_mash(word):
                words[word] += 1

    media_total = sum(media.values())
    return (
        [{"word": word, "count": count}
         for word, count in words.most_common(TOP_CONTENT_LIMIT)],
        {
            "total": media_total,
            "share": round(media_total / len(messages) * 100, 1) if messages else 0.0,
            "items": [{"label": label, "count": count} for label, count in media.most_common()],
        },
        {"uses": sum(words.values()), "unique": len(words)},
    )
