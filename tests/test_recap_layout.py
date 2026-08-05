"""Recap's markup and its player have to agree about the same deck.

These read source text rather than running anything, so they only earn their
place by catching a class of mistake nothing else can: the slide deck is
declared in two files at once. A template nobody plays is invisible, and a card
cell nobody fills prints an empty box on every recap. Both checks compare the
two sources against each other rather than against a list pinned here, so
adding or reordering a slide is free and only a genuine mismatch fails.
"""

import re
from pathlib import Path

ROOT = Path(__file__).parents[1]
TEMPLATE = (ROOT / "app" / "templates" / "recap.html").read_text()
PLAYER = (ROOT / "app" / "static" / "js" / "recap.js").read_text()


def test_every_template_is_played_in_the_order_it_is_declared():
    declared = re.findall(r'<template data-slide="([^"]+)"', TEMPLATE)
    played = re.findall(r'key: "([a-z]+)"', PLAYER)

    assert declared, "no slide templates found — the regex or the markup moved"
    assert played == declared


def test_every_card_cell_is_filled_and_every_filled_cell_exists():
    final = re.search(
        r'<template data-slide="final".*?</template>', TEMPLATE, re.DOTALL
    ).group()
    in_markup = set(re.findall(r'data-cell="([A-Za-z]+)"', final))
    filled = set(re.findall(r'cardCell\(root, "([A-Za-z]+)"', PLAYER))

    assert in_markup, "no card cells found — the regex or the markup moved"
    assert in_markup == filled
