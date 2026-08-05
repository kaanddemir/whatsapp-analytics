from datetime import date

import pytest

from app.analyzer import analyze, metrics, parsing, utils


def chat(*rows):
    """Build a small Android-style WhatsApp export."""
    return "\n".join(
        f"{day}, {clock} - {sender}: {text}"
        for day, clock, sender, text in rows
    )


def test_detect_day_first_prefers_unambiguous_export_evidence():
    assert parsing.detect_day_first(["13/02/24", "02/11/24"])
    assert not parsing.detect_day_first(["02/13/24", "11/02/24"])
    assert parsing.detect_day_first(["02/03/24"])


def test_parse_date_respects_detected_day_order_and_ampm():
    assert parsing.parse_date("02/03/24", "09:15", day_first=True).date() == date(2024, 3, 2)
    assert parsing.parse_date("02/03/24", "09:15", day_first=False).date() == date(2024, 2, 3)
    assert parsing.parse_date("02/03/24", "09:15", "PM", day_first=True).hour == 21


def test_android_and_ios_message_patterns_preserve_senders_and_text():
    parsed = parsing.parse_messages(
        "01/02/24, 09:15 - Alice: Android message\n"
        "[01/02/24, 10:15 PM] Bob: iOS message"
    )

    assert [(msg["sender"], msg["text"]) for msg in parsed] == [
        ("Alice", "Android message"), ("Bob", "iOS message"),
    ]


@pytest.mark.parametrize("blank_sender", ["", " ", "‎"])
def test_a_nameless_row_is_dropped_instead_of_failing_the_whole_export(blank_sender):
    """WhatsApp writes directional marks into exports and the parser strips
    them, so a sender can arrive with no name left. One such row used to raise
    IndexError, which the upload route reported as an unreadable file."""
    stats = analyze(
        f"01/02/24, 09:15 - {blank_sender}: orphan\n"
        "01/02/24, 09:16 - Alice: real message"
    )

    assert stats["meta"]["participants"] == ["Alice"]
    assert stats["kpis"]["total_messages"] == 1


def test_partial_flags_mark_only_partially_covered_buckets():
    bounds = [
        (date(2024, 1, 1), date(2024, 1, 31)),
        (date(2024, 2, 1), date(2024, 2, 29)),
        (date(2024, 3, 1), date(2024, 3, 31)),
    ]
    assert metrics.partial_flags(bounds, date(2024, 1, 12), date(2024, 3, 8)) == [True, False, True]


def test_grain_thresholds_and_largest_remainder_are_stable():
    assert metrics.grain_for(90) == "daily"
    assert metrics.grain_for(91) == "weekly"
    assert metrics.grain_for(180) == "weekly"
    assert metrics.grain_for(181) == "monthly"
    assert utils.largest_remainder([1, 1, 1], 3) == [34, 33, 33]
    assert utils.largest_remainder([17, 17, 67], 101) == [17, 17, 66]


def test_content_rankings_are_limited_to_top_ten():
    emoji_text = "😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙃"
    emoji_ranking, _ = metrics.emojis([{"text": emoji_text}])
    assert len(emoji_ranking) == 10
    assert [item["emoji"] for item in emoji_ranking] == emoji_text.split()[:10]

    keyword_text = "alpha bravo charlie delta epsilon zeta theta iota kappa lambda mu"
    keyword_ranking, _, _ = metrics.keywords([{"text": keyword_text}])
    assert len(keyword_ranking) == 10
    assert [item["word"] for item in keyword_ranking] == keyword_text.split()[:10]


def test_keyword_filters_remove_stopwords_urls_and_keyboard_mash():
    ranking, _, _ = metrics.keywords([{
        "text": "Eray'ın Project the ve https://example.com asdasdasd çoookk",
    }])

    assert ranking == [
        {"word": "eray", "count": 1},
        {"word": "project", "count": 1},
    ]


def test_emoji_ranking_includes_hammer_and_sickle_and_pinwheel_star():
    ranking, _ = metrics.emojis([{"text": "☭" * 8 + " ✯"}])

    assert ranking == [
        {"emoji": "☭", "count": 8},
        {"emoji": "✯", "count": 1},
    ]


def test_emoji_ranking_keeps_flags_zwj_sequences_and_normalized_skin_tones():
    ranking, _ = metrics.emojis([{"text": "🇹🇷 👩‍💻 👍🏽 ☭ ✯"}])

    assert ranking == [
        {"emoji": "🇹🇷", "count": 1},
        {"emoji": "👩‍💻", "count": 1},
        {"emoji": "👍", "count": 1},
        {"emoji": "☭", "count": 1},
        {"emoji": "✯", "count": 1},
    ]


def test_system_and_call_events_do_not_contribute_to_statistics():
    stats = analyze(chat(
        ("01/01/24", "09:00", "Alice", "project update"),
        ("01/01/24", "09:01", "Group name", "You were added"),
        ("01/01/24", "09:02", "Group name", "Bakırköy removed you"),
        ("01/01/24", "09:03", "Alice", "Bakırköy changed group description"),
        ("01/01/24", "09:04", "You", "You started a video call"),
        ("01/01/24", "09:05", "Alice", "Voice call. 8 sec • You joined"),
        ("01/01/24", "09:06", "Group name",
         "Artık bu grubun katılımcısı olmadığınız için gruba mesaj gönderemezsiniz."),
        ("01/01/24", "09:07", "Group name", "You created group"),
        ("01/01/24", "09:08", "Group name",
         "Messages and calls are end-to-end encrypted. Only people in this chat can read them."),
    ))

    assert stats["kpis"]["total_messages"] == 1
    assert stats["meta"]["participants"] == ["Alice"]
    assert stats["top_keywords"] == [
        {"word": "project", "count": 1}, {"word": "update", "count": 1},
    ]


def test_longest_streak_requires_two_consecutive_active_days():
    one_day = analyze(chat(("01/01/24", "09:00", "Alice", "project")))
    consecutive = analyze(chat(
        ("01/01/24", "09:00", "Alice", "project"),
        ("02/01/24", "09:00", "Alice", "update"),
    ))

    assert one_day["insights"]["longest_streak_days"] == 0
    assert one_day["insights"]["longest_streak_range"] == ""
    assert consecutive["insights"]["longest_streak_days"] == 2
    assert consecutive["insights"]["longest_streak_range"] == "Jan 01 – Jan 02, 2024"


def test_missed_call_records_are_excluded_from_all_statistics():
    call_records = (
        "Missed voice call",
        "Missed video call.",
        "Cevapsız sesli arama",
        "Cevapsız görüntülü arama.",
    )
    stats = analyze(chat(
        ("01/01/24", "09:00", "Alice", "project update"),
        *(("01/01/24", f"09:0{index + 1}", "Call record", record)
          for index, record in enumerate(call_records)),
    ))

    assert stats["kpis"]["total_messages"] == 1
    assert stats["meta"]["participants"] == ["Alice"]
    assert stats["media"] == {"total": 0, "share": 0.0, "items": []}
    assert stats["top_keywords"] == [
        {"word": "project", "count": 1}, {"word": "update", "count": 1},
    ]


def test_only_missed_call_records_are_not_analyzable_messages():
    call_only = chat(
        ("01/01/24", "09:00", "Call record", "Missed voice call"),
        ("01/01/24", "09:01", "Call record", "Cevapsız görüntülü arama"),
    )

    with pytest.raises(ValueError, match="No parseable WhatsApp messages"):
        analyze(call_only)


def test_normal_messages_about_calls_are_not_removed():
    stats = analyze(chat(
        ("01/01/24", "09:00", "Alice", "Let's discuss the call tomorrow"),
        ("01/01/24", "09:01", "Bob", "Yarın arama hakkında konuşalım"),
    ))

    assert stats["kpis"]["total_messages"] == 2
    assert stats["media"] == {"total": 0, "share": 0.0, "items": []}


def test_system_event_patterns_do_not_remove_similar_normal_messages():
    stats = analyze(chat(
        ("01/01/24", "09:00", "Alice", "I removed you from the mailing list today"),
        ("01/01/24", "09:01", "Bob", "Bakırköy gruptan çıkardı"),
        ("01/01/24", "09:02", "Carol", "Kaan started a voice call"),
    ))

    assert stats["kpis"]["total_messages"] == 1
    assert stats["meta"]["participants"] == ["Alice"]


def test_meta_ai_is_excluded_from_message_balance_and_interaction_metrics():
    stats = analyze(chat(
        ("01/01/24", "09:00", "Alice", "project update"),
        ("01/01/24", "09:01", "Meta AI", "Here's a summary"),
        ("01/01/24", "09:02", "Bob", "thanks"),
    ))

    # Meta AI messages remain part of overall chat activity.
    assert stats["kpis"]["total_messages"] == 3
    # But the built-in assistant must not be treated as a chat participant.
    assert stats["meta"]["participants"] == ["Alice", "Bob"]
    assert [(p["name"], p["count"], p["pct"]) for p in stats["insights"]["participants"]] == [
        ("Alice", 1, 50), ("Bob", 1, 50),
    ]
    assert stats["insights"]["conversation_starter"] == "Alice"


def test_media_placeholders_count_as_messages_but_not_keywords():
    stats = analyze(chat(
        ("01/01/24", "09:00", "Alice", "image omitted"),
        ("01/01/24", "09:01", "Bob", "project update"),
    ))

    assert stats["kpis"]["total_messages"] == 2
    assert stats["media"]["total"] == 1
    assert stats["top_keywords"] == [
        {"word": "project", "count": 1}, {"word": "update", "count": 1},
    ]
    counts = {person["name"]: person["count"] for person in stats["insights"]["participants"]}
    assert counts == {"Alice": 1, "Bob": 1}


def test_deleted_messages_are_not_included_in_media_breakdown():
    _, media, _ = metrics.keywords([
        {"text": "This message was deleted"},
        {"text": "Bu mesaj silindi"},
        {"text": "image omitted"},
    ])

    assert media == {
        "total": 1,
        "share": round(1 / 3 * 100, 1),
        "items": [{"label": "Photos", "count": 1}],
    }


def test_captioned_and_document_media_placeholders_are_classified_as_media():
    _, media, _ = metrics.keywords([
        {"text": "A long caption for a photo image omitted"},
        {"text": "project_report.pdf • 6 pages document omitted"},
        {"text": "A long caption for a clip video omitted"},
    ])

    assert media == {
        "total": 3,
        "share": 100.0,
        "items": [
            {"label": "Photos", "count": 1},
            {"label": "Documents", "count": 1},
            {"label": "Videos", "count": 1},
        ],
    }


def test_all_localized_media_placeholder_types_are_classified():
    cases = (
        ("caption sticker omitted", "Stickers"),
        ("caption gif omitted", "GIFs"),
        ("caption video note omitted", "Video notes"),
        ("caption video omitted", "Videos"),
        ("caption image omitted", "Photos"),
        ("caption audio omitted", "Voice notes"),
        ("caption contact card omitted", "Contacts"),
        ("report.pdf document omitted", "Documents"),
        ("açıklama çıkartma dahil edilmedi", "Stickers"),
        ("açıklama video notu dahil edilmedi", "Video notes"),
        ("açıklama ses kaydı dahil edilmedi", "Voice notes"),
        ("Toplantı kaydı sesli mesaj dahil edilmedi", "Voice notes"),
        ("Uzun bir açıklama görüntü dahil edilmedi", "Photos"),
        ("rapor belge dahil edilmedi", "Documents"),
    )

    for text, label in cases:
        _, media, _ = metrics.keywords([{"text": text}])
        assert media["total"] == 1
        assert media["items"] == [{"label": label, "count": 1}]

    _, media, _ = metrics.keywords([{"text": "Bu belge dahil edilmedi mi?"}])
    assert media["total"] == 0


def test_unique_tilde_alias_is_merged_with_its_participant():
    stats = analyze(chat(
        ("01/01/24", "09:00", "~ Eray", "first"),
        ("01/01/24", "09:01", "Eray Kağıthane💅", "second"),
        ("01/01/24", "09:02", "Kaan", "third"),
    ))

    counts = {person["name"]: person["count"] for person in stats["insights"]["participants"]}
    assert counts == {"Eray Kağıthane💅": 2, "Kaan": 1}


def test_ambiguous_tilde_alias_remains_a_separate_participant():
    stats = analyze(chat(
        ("01/01/24", "09:00", "~ Ali", "first"),
        ("01/01/24", "09:01", "Ali One", "second"),
        ("01/01/24", "09:02", "Ali Two", "third"),
    ))

    counts = {person["name"]: person["count"] for person in stats["insights"]["participants"]}
    assert counts == {"~ Ali": 1, "Ali One": 1, "Ali Two": 1}


def test_most_active_window_breaks_ties_by_peak_hour_then_earliest_start():
    stats = analyze(chat(
        ("01/01/24", "00:00", "Alice", "first"),
        ("01/01/24", "04:00", "Bob", "second"),
    ))

    assert stats["insights"]["most_active_time"] == "00:00 - 04:00"


def test_conversation_starter_ties_follow_message_order():
    stats = analyze(chat(
        ("01/01/24", "09:00", "Alice", "first"),
        ("01/01/24", "09:01", "Bob", "reply"),
        ("01/01/24", "15:02", "Bob", "new conversation"),
        ("01/01/24", "15:03", "Alice", "reply"),
    ))

    insights = stats["insights"]
    assert insights["conversation_starter"] == "Alice"
    assert insights["conversation_starter_pct"] == 50
    assert insights["conversation_starter_count"] == 1
    assert insights["conversation_count"] == 2


def test_info_card_summaries_cover_all_content_not_just_top_ten():
    stats = analyze(chat(
        ("01/01/24", "09:00", "Alice", "project 😀 😀"),
        ("01/01/24", "09:01", "Bob", "project update 😃"),
    ))

    assert stats["content_summary"] == {
        "emojis": {"uses": 3, "message_count": 2},
        "keywords": {"uses": 3, "unique": 2},
    }


def test_info_card_summaries_are_zero_without_emojis_or_keywords():
    stats = analyze(chat(("01/01/24", "09:00", "Alice", "image omitted")))

    assert stats["content_summary"] == {
        "emojis": {"uses": 0, "message_count": 0},
        "keywords": {"uses": 0, "unique": 0},
    }


def test_night_owl_ties_follow_participant_order():
    stats = analyze(chat(
        ("01/01/24", "00:00", "Alice", "night"),
        ("01/01/24", "01:00", "Bob", "night"),
        ("01/01/24", "10:00", "Alice", "day"),
        ("01/01/24", "11:00", "Bob", "day"),
    ))

    insights = stats["insights"]
    assert insights["night_owl"] == "Alice"
    assert insights["night_owl_share"] == 50.0
