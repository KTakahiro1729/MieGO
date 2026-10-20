---
name: miego-sgf-url
description: Interpret or generate MieGO replay URLs (Go, Gomoku or a free board; 9x9, 13x13 or 19x19) containing encoded SGF in the sgf query parameter and a selected position in move.
---

# MieGO SGF URL skill

When a user provides a MieGO URL, interpret its `sgf` parameter as the complete URL-encoded SGF record for a 9x9, 13x13 or 19x19 game (its SZ property), and `move` as the number of completed moves in the displayed position (0 = empty; omitted = full game). A pass counts as a move.

The record is usually Go (`GM[1]`; `RU[Japanese]` or `RU[Korean]` replays with Japanese territory scoring, any other ruleset with Chinese area scoring). It can also be Gomoku (`GM[4]`, with `RU[Renju]` when Black's forbidden moves apply), or a free board: setup stones only (`RU[Free]`, `AB`/`AW`, no moves), which opens on the whole position.

To reference another point in the same game, keep `sgf` unchanged and change only `move`. To illustrate a hypothetical sequence, generate a *valid SGF* with the alternative moves, percent-encode it as `sgf`, and set `move` to the intended position. Keep the user's MieGO origin unchanged. Never guess a board you cannot reconstruct from SGF.

Users can open the URL in a second browser tab, scrub backward/forward on the board, and examine positions while chatting with their own AI. MieGO does not have an integrated LLM. Do not force a particular question or teaching style.

See the authoritative implementation rules at `/ai.md` on the same MieGO origin. The SGF URL alone contains the record; do not request a separate pasted SGF body.

AI-oriented handoffs may include a plain-text board of the same size alongside the SGF URL.
The glyphs are **● black, ○ white, ・ empty**, displayed as as many rows and columns as the board (9, 13 or 19)
without coordinate headers or row numbers.
The glyph board is supplemental: reconstruct the move history from SGF and
report any disagreement, rather than treating glyphs as a substitute for moves,
passes, or ko history. A forbidden-move question includes the same public SGF
replay URL for committed moves and marks the attempted empty point with **◇**.
That attempted illegal move is NOT part of the SGF.
A beginner's position question from the help sheet carries the same replay URL
(omitted when the game is too long for one) and glyph board; answer locations
as "row N from the top, column M from the left". Never ask for or copy
private P2P invitation URLs.
