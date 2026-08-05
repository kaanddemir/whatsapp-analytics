"""A rolling burst limit on assistant requests.

There is no daily cap: every user supplies their own Groq API key, so the cost
of a request lands on their own account and metering it here would only be a
second, less informative version of the limit Groq already enforces. What is
still worth stopping is a runaway client sending in a loop.
"""

import time

from .. import config

# In-memory rate-limit windows: sid -> [request timestamps within last 60s].
_RATE = {}


def rate_ok(sid):
    """True if `sid` is under the burst cap; records this attempt when allowed."""
    now = time.time()
    window = [t for t in _RATE.get(sid, []) if t > now - 60]
    if len(window) >= config.AI_RATE_PER_MIN:
        _RATE[sid] = window
        return False
    window.append(now)
    _RATE[sid] = window
    return True
