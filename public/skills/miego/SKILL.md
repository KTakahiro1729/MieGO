---
name: miego-sgf-url
description: Interpret or generate MieGO 9x9 Go replay URLs containing encoded SGF in the sgf query parameter and a selected position in move.
---

# MieGO SGF URL skill

When a user provides a MieGO URL, interpret its `sgf` parameter as the complete URL-encoded SGF record for a 9x9 Go game, and `move` as the number of completed moves in the displayed position (0 = empty; omitted = full game). A pass counts as a move.

To reference another point in the same game, keep `sgf` unchanged and change only `move`. To illustrate a hypothetical sequence, generate a *valid SGF* with the alternative moves, percent-encode it as `sgf`, and set `move` to the intended position. Keep the user's MieGO origin unchanged. Never guess a board you cannot reconstruct from SGF.

Users can open the URL in a second browser tab, scrub backward/forward on the board, and examine positions while chatting with their own AI. MieGO does not have an integrated LLM. Do not force a particular question or teaching style.

See the authoritative implementation rules at `/ai.md` on the same MieGO origin. The SGF URL alone contains the record; do not request a separate pasted SGF body.
