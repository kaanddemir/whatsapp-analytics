"""Turn a raw WhatsApp export into a sorted list of {dt, sender, text} dicts."""

from datetime import datetime
import unicodedata

from .patterns import (
    ANDROID_RE,
    DATE_PARTS_RE,
    IOS_RE,
    SYSTEM_LINE_RE,
    SYSTEM_EVENT_PATTERNS,
)


def norm_ampm(token):
    """Normalise a 12-hour marker to AM/PM. Turkish exports use ÖÖ/ÖS."""
    if not token:
        return None
    t = token.strip().lower()
    if t in ("öö", "oo"):
        return "AM"
    if t in ("ös", "os"):
        return "PM"
    return t.upper()


def detect_day_first(datestrs):
    """Decide D/M/Y vs M/D/Y once for the whole file.

    Deciding per message silently mixes both: in a US export "03/05/24" parses
    as 3 May under D/M/Y while "05/13/24" only fits M/D/Y, so half the file ends
    up on the wrong calendar. Any date whose first part exceeds 12 proves D/M/Y
    (and vice versa); the majority of those unambiguous dates decides the file.
    """
    day_first = month_first = 0
    for ds in datestrs:
        m = DATE_PARTS_RE.match(ds)
        if not m:
            continue
        a, b = int(m.group(1)), int(m.group(2))
        if a > 12 >= b:
            day_first += 1
        elif b > 12 >= a:
            month_first += 1
    # Ambiguous exports default to D/M/Y.
    return month_first <= day_first


def parse_date(datestr, timestr, ampm=None, day_first=True):
    datestr = datestr.replace(".", "/")
    date_formats = ("%d/%m", "%m/%d") if day_first else ("%m/%d", "%d/%m")
    if ampm:
        # Preserve the AM/PM marker when parsing 12-hour exports.
        timestr = f"{timestr} {ampm}"
        time_formats = ("%I:%M:%S %p", "%I:%M %p")
    else:
        time_formats = ("%H:%M:%S", "%H:%M")
    stamp = f"{datestr} {timestr}".strip()
    for dfmt in date_formats:
        # %Y before %y would swallow a 2-digit year as year 24, so try %y first.
        for yfmt in ("%y", "%Y"):
            for tfmt in time_formats:
                try:
                    return datetime.strptime(stamp, f"{dfmt}/{yfmt} {tfmt}")
                except ValueError:
                    continue
    return None


def parse_messages(text):
    """Return a list of dicts: {dt, sender, text}. Handles multi-line msgs."""
    raw_rows = []
    for raw in text.splitlines():
        # Normalize WhatsApp's directional and narrow no-break space markers.
        line = (raw.replace("‎", "")
                   .replace(" ", " ").replace("\xa0", " ").rstrip("\n"))
        m = IOS_RE.match(line) or ANDROID_RE.match(line)
        if m:
            raw_rows.append({
                "date": m.group("date"),
                "time": m.group("time"),
                "ampm": norm_ampm(m.groupdict().get("ampm")),
                "sender": m.group("sender").strip(),
                "text": m.group("msg"),
            })
        elif SYSTEM_LINE_RE.match(line):
            continue  # timestamped system event, not part of any message
        elif raw_rows:
            # continuation of previous multi-line message
            raw_rows[-1]["text"] += "\n" + line

    day_first = detect_day_first(r["date"] for r in raw_rows)
    return [{
        "dt": parse_date(r["date"], r["time"], r["ampm"], day_first),
        "sender": r["sender"],
        "text": r["text"],
    } for r in raw_rows]


def is_system_event(text):
    """Whether a regular-looking row is a WhatsApp system or call event."""
    content = text.strip()
    return any(pattern.match(content) for pattern in SYSTEM_EVENT_PATTERNS)


def is_meta_ai_sender(sender):
    """Whether ``sender`` is WhatsApp's built-in Meta AI account.

    Meta AI messages remain available to volume and content statistics, but the
    account is not a human chat participant and must not affect Message Balance
    or other person-to-person interaction metrics.
    """
    normalized = unicodedata.normalize("NFKC", sender).strip().casefold()
    return normalized in {"meta ai", "@meta ai"}


def _first_name(sender):
    """The first name token of ``sender``, or None when it has none at all.

    A row can reach here with an empty sender: WhatsApp writes directional
    marks into exports, ``parse_messages`` strips them, and a name made only of
    those marks is left blank. Such a row cannot be attributed to anyone, and
    returning None here is what keeps it from crashing the whole upload.
    """
    names = unicodedata.normalize("NFKC", sender).strip().split()
    return names[0] if names else None


def _alias_first_name(sender):
    """Return the one-word name in a conservative ``~ Name`` alias, if any."""
    normalized = unicodedata.normalize("NFKC", sender).strip()
    if not normalized.startswith("~"):
        return None
    names = normalized[1:].strip().split()
    return names[0] if len(names) == 1 else None


def canonicalize_senders(messages):
    """Merge ``~ Name`` aliases only when one participant has that first name."""
    candidates = {}
    for msg in messages:
        if _alias_first_name(msg["sender"]):
            continue
        first_name = _first_name(msg["sender"])
        if first_name is None:
            continue
        candidates.setdefault(first_name.casefold(), set()).add(msg["sender"])

    aliases = {}
    for msg in messages:
        alias = _alias_first_name(msg["sender"])
        if not alias:
            continue
        matches = candidates.get(alias.casefold(), set())
        if len(matches) == 1:
            aliases[msg["sender"]] = next(iter(matches))

    if not aliases:
        return messages
    return [{**msg, "sender": aliases.get(msg["sender"], msg["sender"])} for msg in messages]


def real_messages(parsed):
    """Drop unattributable rows and system events, normalize aliases, then sort."""
    real = []
    for msg in parsed:
        if msg["dt"] is None:
            continue
        # No name at all, so no participant metric can hold it. Dropping the row
        # is the same treatment an unparseable timestamp gets.
        if _first_name(msg["sender"]) is None:
            continue
        if is_system_event(msg["text"]):
            continue
        real.append(msg)
    return canonicalize_senders(sorted(real, key=lambda msg: msg["dt"]))


def filter_range(messages, start, end):
    """Keep messages within the inclusive ISO date range; None means no bound."""
    if start:
        start_date = datetime.strptime(start, "%Y-%m-%d").date()
        messages = [msg for msg in messages if msg["dt"].date() >= start_date]
    if end:
        end_date = datetime.strptime(end, "%Y-%m-%d").date()
        messages = [msg for msg in messages if msg["dt"].date() <= end_date]
    return messages
