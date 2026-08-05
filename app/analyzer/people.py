"""Per-participant metrics and the derived insight cards."""

from collections import Counter, defaultdict

from .utils import fmt_duration, largest_remainder, median

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def reply_speed(messages):
    """Per sender, the gaps where they answered someone else within 48h."""
    speeds = defaultdict(list)
    for index in range(1, len(messages)):
        previous, current = messages[index - 1], messages[index]
        if current["sender"] == previous["sender"]:
            continue
        delta = (current["dt"] - previous["dt"]).total_seconds()
        if 0 <= delta < 60 * 60 * 48:
            speeds[current["sender"]].append(delta)
    return speeds


def participants(senders, reply_speeds):
    ranked = senders.most_common()
    total = sum(senders.values())
    shares = largest_remainder([count for _, count in ranked], total)
    return [
        {
            "name": name,
            "count": count,
            "pct": pct,
            "pct_label": (
                "<1%" if pct == 0 and count
                else ">99%" if pct == 100 and count < total
                else f"{pct}%"
            ),
            "avg_response_label": fmt_duration(median(reply_speeds.get(name, []))),
        }
        for (name, count), pct in zip(ranked, shares)
    ]


def conversation_starter_details(messages):
    """Return the leading starter plus the full number of conversations."""
    gap = 6 * 60 * 60
    initiations = Counter()
    for index, msg in enumerate(messages):
        if index == 0 or (msg["dt"] - messages[index - 1]["dt"]).total_seconds() > gap:
            initiations[msg["sender"]] += 1
    total = sum(initiations.values()) or 1
    name, count = initiations.most_common(1)[0] if initiations else ("", 0)
    return name, round(count / total * 100), count, total


def night_owl(messages, senders):
    if not senders:
        return "", 0, 0.0
    night_messages = Counter(
        msg["sender"] for msg in messages if msg["dt"].hour in range(0, 5)
    )
    eligible = [name for name, count in senders.items() if count >= 20] or list(senders)
    name = max(eligible, key=lambda candidate: (
        night_messages[candidate] / senders[candidate], night_messages[candidate]))
    count = night_messages[name]
    return name, count, round(count / senders[name] * 100, 1) if count else 0.0


def insights(messages, hours, peak_hour, weekday_avgs, people, starter, owl):
    def window_total(start):
        return sum(hours[(start + offset) % 24] for offset in range(4))

    best_start = max(
        range(24),
        key=lambda start: (
            window_total(start),
            peak_hour in {(start + offset) % 24 for offset in range(4)},
            -start,
        ),
    )
    busiest_weekday = max(range(7), key=lambda index: weekday_avgs[index])
    active_days = sorted({msg["dt"].date() for msg in messages})
    longest = current = 1
    best_end = 0
    for index in range(1, len(active_days)):
        current = current + 1 if (active_days[index] - active_days[index - 1]).days == 1 else 1
        if current > longest:
            longest, best_end = current, index
    if longest < 2:
        streak_range = ""
    else:
        streak_start, streak_end = active_days[best_end - longest + 1], active_days[best_end]
        if streak_start.year == streak_end.year:
            streak_range = f"{streak_start.strftime('%b %d')} – {streak_end.strftime('%b %d, %Y')}"
        else:
            streak_range = f"{streak_start.strftime('%b %d, %Y')} – {streak_end.strftime('%b %d, %Y')}"

    return {
        "most_active_time": f"{best_start:02d}:00 - {(best_start + 4) % 24:02d}:00",
        "most_active_share": round(window_total(best_start) / len(messages) * 100),
        "participants": people,
        "conversation_starter": starter[0],
        "conversation_starter_pct": starter[1],
        "conversation_starter_count": starter[2],
        "conversation_count": starter[3],
        "busiest_day": DAY_NAMES[busiest_weekday],
        # A single active day is activity, not a streak.
        "longest_streak_days": longest if longest >= 2 else 0,
        "longest_streak_range": streak_range,
        "night_owl": owl[0],
        "night_owl_count": owl[1],
        "night_owl_share": owl[2],
    }
