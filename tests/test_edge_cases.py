"""Exports at the edges of the range the dashboard and Recap have to survive.

Every case here is a real shape a WhatsApp export can take: a chat with one
message in it, a chat with only one person, a chat that is nothing but media,
one spanning years, and a group large enough that the per-participant sections
have to fold. The assertions deliberately stay at the level of "the payload is
complete and self-consistent" rather than checking individual numbers, which
the analyzer tests already cover.
"""

import io

import pytest

from app import create_app
from app.services import store


@pytest.fixture
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def upload(client, body):
    return client.post(
        "/api/upload",
        data={"file": (io.BytesIO(body.encode()), "chat.txt")},
        content_type="multipart/form-data",
    )


# ---- The exports ---------------------------------------------------------
SINGLE_MESSAGE = "01/01/24, 09:00 - Alice: merhaba\n"

ONE_PARTICIPANT = "".join(
    f"0{day}/01/24, 1{day}:0{day} - Alice: mesaj numarasi {day}\n"
    for day in range(1, 9)
)

ONLY_MEDIA = "".join(
    f"0{day}/01/24, 09:0{day} - Alice: image omitted\n" for day in range(1, 6)
)

# Five years, one message a month, so every monthly bucket exists.
FIVE_YEARS = "".join(
    f"15/{month:02d}/{year} , 12:30 - Alice: kelime{month} baska{year}\n".replace(" ,", ",")
    for year in range(2019, 2024)
    for month in range(1, 13)
)

# Fifty people is past every per-participant cap the UI applies.
LARGE_GROUP = "".join(
    f"{(i % 28) + 1:02d}/01/24, {i % 24:02d}:{i % 60:02d} - Kisi{i % 50}: "
    f"soz{i} baskasoz{i}\n"
    for i in range(300)
)

CASES = {
    "single_message": SINGLE_MESSAGE,
    "one_participant": ONE_PARTICIPANT,
    "only_media": ONLY_MEDIA,
    "five_years": FIVE_YEARS,
    "large_group": LARGE_GROUP,
}


def assert_complete(stats):
    """Every field the dashboard and Recap read, present and the right shape."""
    kpis, meta, insights = stats["kpis"], stats["meta"], stats["insights"]

    assert kpis["total_messages"] >= 1
    assert kpis["active_days"] >= 1
    assert isinstance(kpis["peak_hour"], str) and ":" in kpis["peak_hour"]
    assert meta["participants"] or stats["kpis"]["total_messages"]
    assert meta["range_iso"]["start"] <= meta["range_iso"]["end"]
    assert meta["full_range"]["start"] <= meta["full_range"]["end"]

    assert len(stats["hours"]) == 24
    assert len(stats["heatmap"]) == 7
    assert all(len(row) == 24 for row in stats["heatmap"])

    over_time = stats["messages_over_time"]
    assert over_time["grain"] in {"daily", "weekly", "monthly"}
    for grain in ("daily", "weekly", "monthly"):
        series = over_time[grain]
        # The chart pairs these positionally; a mismatch silently mislabels it.
        assert len(series["labels"]) == len(series["values"]) == len(series["partial"])
        assert series["values"], grain

    # Recap's counters and the card-info panels divide by these.
    assert stats["media"]["total"] >= 0
    assert 0 <= stats["media"]["share"] <= 100
    assert insights["longest_streak_days"] != 1, "one active day is not a streak"
    assert sum(p["pct"] for p in insights["participants"]) in (0, 100)


@pytest.mark.parametrize("name", sorted(CASES))
def test_upload_range_and_recap_all_succeed(client, name):
    """The three analysis routes must handle every shape without failing."""
    body = CASES[name]

    uploaded = upload(client, body)
    assert uploaded.status_code == 200, uploaded.get_json()
    assert_complete(uploaded.get_json()["stats"])

    recap = client.get("/api/recap")
    assert recap.status_code == 200, recap.get_json()
    assert_complete(recap.get_json()["stats"])

    unfiltered = client.post("/api/range", json={})
    assert unfiltered.status_code == 200, unfiltered.get_json()
    assert_complete(unfiltered.get_json()["stats"])


@pytest.mark.parametrize("name", sorted(CASES))
def test_filtering_to_a_participant_succeeds(client, name):
    stats = upload(client, CASES[name]).get_json()["stats"]

    # A few per export, not all of them: on the fifty-person group the
    # remaining forty-seven re-walk the same code path for no extra coverage.
    for participant in stats["meta"]["participants"][:3]:
        filtered = client.post("/api/range", json={"sender": participant})
        assert filtered.status_code == 200, filtered.get_json()
        payload = filtered.get_json()["stats"]
        assert payload["meta"]["active_sender"] == participant
        assert_complete(payload)


def test_recap_always_covers_the_whole_chat_not_the_filter(client):
    """The story ignores the dashboard's selection, which is its whole point."""
    upload(client, LARGE_GROUP)
    total = client.get("/api/recap").get_json()["stats"]["kpis"]["total_messages"]

    client.post("/api/range", json={"sender": "Kisi0"})
    assert client.get("/api/stats").get_json()["stats"]["kpis"]["total_messages"] < total
    assert client.get("/api/recap").get_json()["stats"]["kpis"]["total_messages"] == total


def test_recap_is_computed_once_per_uploaded_chat(client):
    """Re-analysing a large export on every open is seconds of wasted work."""
    upload(client, FIVE_YEARS)
    with client.session_transaction() as session:
        sid = session["sid"]

    # The upload is already unfiltered, so the story needs no second parse.
    cached = store.get_full_stats(sid)
    assert cached is not None
    # A marker only the stored object carries: an equal payload would also be
    # true of a rebuild, so equality alone would not prove the cache was used.
    cached["cache_marker"] = "served-from-store"
    assert client.get("/api/recap").get_json()["stats"].get("cache_marker") == "served-from-store"
    del cached["cache_marker"]

    # A filter must not disturb it, but a different chat must replace it.
    client.post("/api/range", json={"sender": "Alice"})
    assert store.get_full_stats(sid) is cached
    upload(client, SINGLE_MESSAGE)
    assert store.get_full_stats(sid) is not cached


def test_reset_forgets_the_recap_too(client):
    upload(client, ONE_PARTICIPANT)
    client.post("/api/reset")

    assert client.get("/api/recap").status_code == 400


def test_oversized_upload_reports_json_not_html(client):
    """The frontend parses every response as JSON, including this failure."""
    oversized = b"x" * (client.application.config["MAX_CONTENT_LENGTH"] + 1024)
    response = client.post(
        "/api/upload",
        data={"file": (io.BytesIO(oversized), "chat.txt")},
        content_type="multipart/form-data",
    )

    assert response.status_code == 413
    assert response.is_json
    assert response.get_json()["reason"] == "too_large"
