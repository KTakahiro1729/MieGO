import {
  BLACK,
  WHITE,
  boardHash,
  emptyRegions,
  group,
  groups,
  isJapanese,
  neighbors,
  play,
  resume,
  sizeOf,
} from "./core.mjs";
import { OWNERSHIP_BANDS } from "./territory-view.mjs";

/**
 * 決着手順: before the count, KataGo finishes the board on a scratch copy the
 * way the rules finish it after both players stop. The players stopped the
 * match, so nothing that could change the result is played (日本囲碁規約
 * 第九条: the game is what was played up to the stop, unless a player resumes
 * it). The playout only fills the dame between the two sides and, under area
 * scoring, captures the stones KataGo calls dead, which costs nothing there.
 * Under Japanese rules dead stones are taken off without being captured
 * (第十条), so they stay on the board and the count marks them. Open borders
 * and undecided areas are left as they are and count for nobody (第八条);
 * playing them out is the players' choice (対局を再開). The match itself
 * never changes.
 */

/** A guard against a playout that never ends (simple ko only stops direct
 * recaptures, so a triple ko could cycle): four thirds of the board (108,
 * 225 or 481 moves). Real playouts end with two passes long before it. */
export const settleMax = size => Math.round(size * size * 4 / 3);

/** A scratch position to play out from: the scoring position, playable again. */
export function settleStart(game) {
  const state = game.status === "scoring" ? resume(game) : game;
  return { ...state, status: "playing", passes: 0, endProposal: null, takebackRequest: undefined,
    dead: [], agreed: { black: false, white: false } };
}

/** Stones of the groups KataGo's ownership firmly gives to the other side. */
function deadByOwnership(board, ownership) {
  const dead = new Set();
  if (!Array.isArray(ownership) || ownership.length !== board.length) return dead;
  for (const { color, stones } of groups(board)) {
    if (color !== BLACK && color !== WHITE) continue;
    const control = [...stones].map(s => -color * ownership[s]);
    if (control.every(v => v >= 0.7) && control.reduce((a, b) => a + b, 0) / control.length >= 0.85)
      for (const s of stones) dead.add(s);
  }
  return dead;
}

/**
 * Liberties of opponent groups that KataGo's ownership already gives to the
 * player to move: the points to fill so those dead stones come off the board.
 */
export function captureTargets(state, ownership) {
  const board = state.board, me = state.next, targets = new Set(), dead = deadByOwnership(board, ownership);
  for (const { color, stones, liberties } of groups(board))
    if (color === -me && dead.has([...stones][0])) for (const p of liberties) targets.add(p);
  return targets;
}

/**
 * 駄目: empty points next to stones of both colours, in an empty area that
 * touches both (so nobody's territory). Stones the ownership calls dead do not
 * count, so the points around a dead stone inside an area stay that area's.
 * The mover fills one only where its own group keeps two liberties: a fill
 * that puts it in atari (seki's shared liberties among them) is left open.
 */
export function damePoints(state, ownership = null) {
  const board = state.board, size = sizeOf(board), me = state.next, points = new Set();
  const dead = deadByOwnership(board, ownership);
  const live = board.map((stone, i) => dead.has(i) ? 0 : stone);
  // An area with an owner is bordered by one colour alone (or by none on an
  // empty board, where no point touches both colours anyway).
  for (const { points: area, owner } of emptyRegions(live)) {
    if (owner) continue;
    for (const p of area) {
      if (board[p]) continue;
      const around = neighbors(p, size).map(n => live[n]);
      if (!around.includes(BLACK) || !around.includes(WHITE)) continue;
      const next = [...board]; next[p] = me;
      if (group(next, p).liberties.size >= 2) points.add(p);
    }
  }
  return points;
}

/**
 * The mover's next settle move, or null to pass. Under area scoring the mover
 * first fills the liberties of opponent stones its ownership calls dead, so
 * the playout really removes them; then, under either rules, it fills the
 * dame that are not the opponent's, so the count leaves no point open between
 * the two sides. KataGo's policy only orders those points: an open point, a
 * border still to close or a move inside either area is never played. The
 * ownership is the one of the scoring position, so the stones dead there are
 * the only ones taken: a capture cannot make others look dead and go on.
 */
export function pickSettleMove(state, policy, ownership = null) {
  if (state.status !== "playing" || !Array.isArray(policy) || policy.length !== state.board.length) return null;
  const board = state.board, me = state.next;
  const known = Array.isArray(ownership) && ownership.length === board.length;
  const mine = p => known ? me * ownership[p] : 0;
  const order = policy.map((logit, p) => [logit, p])
    .filter(([logit, p]) => Number.isFinite(logit) && !board[p])
    .sort((a, b) => b[0] - a[0]);
  // No move brings back a board seen before (positional superko), so captures
  // and recaptures cannot cycle, with single passes between them, for ever.
  const seen = new Set(state.history || []);
  const legal = p => { try { return !seen.has(boardHash(play(state, p).board)); } catch { return false; } };
  if (!isJapanese(state)) {
    const targets = captureTargets(state, ownership);
    for (const [, p] of order) if (targets.has(p) && legal(p)) return p;
  }
  const dame = damePoints(state, ownership);
  for (const [, p] of order) if (dame.has(p) && mine(p) > -OWNERSHIP_BANDS.SETTLED && legal(p)) return p;
  return null;
}

/** Plays one settle move on the scratch state; the playout ends after two passes. */
export function settleStep(state, position) {
  const next = play(state, position);
  return next.status === "scoring" ? { ...next, status: "settled" } : next;
}

/**
 * Dead stones of the original position, by whole groups: a group is dead if
 * the playout captured it, or if KataGo's ownership of the settled board
 * gives every one of its stones firmly to the opponent.
 */
export function deadFromPlayout(original, settledBoard, ownership) {
  const board = original.board, dead = new Set();
  const valid = Array.isArray(ownership) && ownership.length === board.length &&
    ownership.every(Number.isFinite);
  for (const { color, stones: members } of groups(board)) {
    const stones = [...members];
    if (color !== BLACK && color !== WHITE) continue;
    const captured = stones.every(s => settledBoard[s] !== color);
    const lost = valid && stones.every(s => color * ownership[s] <= -0.7) &&
      stones.reduce((sum, s) => sum + color * ownership[s], 0) / stones.length <= -0.85;
    if (captured || lost) for (const s of stones) dead.add(s);
  }
  return [...dead].sort((a, b) => a - b);
}

/** A received playout (from the friend who ran it) replayed and checked; null if it is not legal. */
export function replayPlayout(game, positions) {
  const size = sizeOf(game.board);
  if (!Array.isArray(positions) || positions.length > settleMax(size)) return null;
  let state = settleStart(game);
  const frames = [state];
  try {
    for (const p of positions) {
      if (state.status !== "playing") return null;
      if (p !== null && !(Number.isInteger(p) && p >= 0 && p < game.board.length)) return null;
      state = settleStep(state, p);
      frames.push(state);
    }
  } catch { return null; }
  return frames;
}
