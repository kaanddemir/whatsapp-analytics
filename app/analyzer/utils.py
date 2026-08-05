"""Small pure helpers shared by the parsing and metric modules."""

from .patterns import MASH_RE, MEDIA_KINDS, STRETCH_RE, TAIL_DOUBLE_RE


def lower_tr(s):
    """Lowercase without breaking Turkish.

    str.lower() maps I to i (should be ı) and İ to "i" + U+0307, and the
    combining dot is not a word character, so "İyi" tokenises as "yi" and
    "İstanbul" as "stanbul". Fold the two dotted/dotless pairs by hand first.
    """
    return s.replace("I", "ı").replace("İ", "i").lower()


def largest_remainder(counts, total):
    """Integer percentages that sum to exactly 100.

    Rounding each share on its own drifts: three equal senders each round to
    33 and the balance bar ends 1% short of full, while 17/17/67 rounds to 101
    and overflows. Hand the leftover points to the largest fractions instead.
    """
    if not total or not counts:
        return [0] * len(counts)
    # Integer arithmetic avoids floating-point tie noise.
    scaled = [c * 100 for c in counts]
    pct = [s // total for s in scaled]
    rem = [s % total for s in scaled]
    # Ties go to the smaller sender, which is what keeps equal senders equal.
    order = sorted(range(len(counts)), key=lambda i: (rem[i], -counts[i]), reverse=True)
    for i in order[:100 - sum(pct)]:
        pct[i] += 1
    return pct


def media_kind(low):
    """Label for an already-matched placeholder. "<Media omitted>" names no
    type, which is all Android exports write, so it falls through to Other."""
    for label, keys in MEDIA_KINDS:
        if any(k in low for k in keys):
            return label
    return "Other"


def fold_stretch(word):
    """"çoookk" -> "çok". See STRETCH_RE for why the two passes differ."""
    return TAIL_DOUBLE_RE.sub(r"\1", STRETCH_RE.sub(r"\1", word))


def is_mash(word):
    """True for keyboard mash ("asdasdasd"), which is never a keyword."""
    return bool(MASH_RE.match(word))


def median(values):
    if not values:
        return 0
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return int(ordered[middle])
    return int((ordered[middle - 1] + ordered[middle]) / 2)


def fmt_duration(seconds):
    if seconds <= 0:
        return "—"
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m"
    if seconds < 86400:
        h = seconds // 3600
        m = (seconds % 3600) // 60
        return f"{h}h {m}m" if m else f"{h}h"
    d = seconds // 86400
    h = (seconds % 86400) // 3600
    return f"{d}d {h}h" if h else f"{d}d"
