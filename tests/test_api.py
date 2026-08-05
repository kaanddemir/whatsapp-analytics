"""Smoke tests for the factory + blueprint wiring, not for the statistics."""

import io

import pytest

from app import create_app

EXPORT = (
    "01/01/24, 09:00 - Alice: first\n"
    "01/01/24, 09:01 - Bob: reply\n"
)


@pytest.fixture
def client():
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as client:
        yield client


def upload(client, name="chat.txt", body=EXPORT):
    return client.post(
        "/api/upload",
        data={"file": (io.BytesIO(body.encode()), name)},
        content_type="multipart/form-data",
    )


def test_index_renders(client):
    assert client.get("/").status_code == 200


def test_stats_empty_before_upload(client):
    assert client.get("/api/stats").get_json() == {"loaded": False}


def test_upload_then_stats_round_trip(client):
    assert upload(client).get_json()["loaded"] is True

    stats = client.get("/api/stats").get_json()["stats"]
    assert stats["kpis"]["total_messages"] == 2
    assert sorted(stats["meta"]["participants"]) == ["Alice", "Bob"]


def test_upload_rejects_non_txt(client):
    resp = upload(client, name="chat.pdf")
    assert resp.status_code == 400
    assert "error" in resp.get_json()


def test_range_requires_a_prior_upload(client):
    resp = client.post("/api/range", json={})
    assert resp.status_code == 400


def test_range_filters_to_one_participant(client):
    upload(client)

    stats = client.post("/api/range", json={"sender": "Alice"}).get_json()["stats"]
    assert stats["kpis"]["total_messages"] == 1
    assert stats["meta"]["active_sender"] == "Alice"
    assert stats["content_summary"] == {
        "emojis": {"uses": 0, "message_count": 0},
        "keywords": {"uses": 1, "unique": 1},
    }


def test_upload_response_includes_info_card_summaries(client):
    stats = upload(client).get_json()["stats"]

    assert stats["content_summary"] == {
        "emojis": {"uses": 0, "message_count": 0},
        "keywords": {"uses": 2, "unique": 2},
    }
    assert stats["insights"]["conversation_starter_count"] == 1
    assert stats["insights"]["conversation_count"] == 1


def test_reset_forgets_the_chat(client):
    upload(client)

    assert client.post("/api/reset").get_json() == {"loaded": False}
    assert client.get("/api/stats").get_json() == {"loaded": False}


