import {
  BLACK,
  WHITE,
  boardHash,
  emptyRegions,
  group,
  groups,
  neighbors,
  play,
  resume,
  sizeOf,
} from "./core.mjs";
import { OWNERSHIP_BANDS } from "./territory-view.mjs";

/**
 * 決着手順: before the count, KataGo plays the position out on a scratch copy
 * until both sides pass. It is there for two things: to reach a board where
 * best play from here on would no longer change the result, and to leave
 * that board in the shape that is easiest to count (dead stones captured,
 * borders closed, dame filled). So it only plays where the outcome is still
 * open: never inside an area KataGo already calls settled (that would only be
 * a ko threat or a wasted move there), except to close its own border, take
 * dead stones or fill dame. The match itself never changes.
 */

/** A guard against a playout that never ends (simple ko only stops direct
 * recaptures, so a triple ko could cycle): four thirds of the board (108,
 * 225 or 481 moves). Real playouts end with two passes long before it. */
export const settleMax = size => Math.round(size * size * 4 / 3);
/** The pause between shown playout moves: 333ms on 9x9, shorter on bigger
 * boards, so a playout over a third of the board takes about ten seconds
 * (at most 15 on 19x19). */
export const settleStepMs = size => Math.min(360, Math.max(120, Math.round(9000 / Math.round(size * size / 3))));

/** A scratch position to play out from: the scoring position, playable again. */
export function settleStart(game) {
  const state = game.status === "scoring" ? resume(game) : game;
  return { ...state, status: "playing", passes: 0, endProposal: null, takebackRequest: undefined,
    dead: [], agreed: { black: false, white: false } };
}

/** An empty point whose neighbours are all the mover's own stones (an eye). */
function ownEye(board, point, color) {
  return neighbors(point, sizeOf(board)).every(n => board[n] === color);
}

/**
 * Liberties of opponent groups that KataGo's ownership already gives to the
 * player to move: the points to fill so those dead stones come off the board.
 */
export function captureTargets(state, ownership) {
  const board = state.board, me = state.next, targets = new Set();
  if (!Array.isArray(ownership) || ownership.length !== board.length) return targets;
  for (const { color, stones, liberties } of groups(board)) {
    if (color !== -me) continue;
    const control = [...stones].map(s => me * ownership[s]);
    if (control.every(v => v >= 0.7) && control.reduce((a, b) => a + b, 0) / control.length >= 0.85)
      for (const p of liberties) targets.add(p);
  }
  return targets;
}

/**
 * 駄目: empty points next to stones of both colours, in an empty area that
 * touches both (so nobody's territory). The mover fills one only where its
 * own group keeps two liberties: a fill that puts it in atari (seki's shared
 * liberties among them) is left open.
 */
export function damePoints(state) {
  const board = state.board, size = sizeOf(board), me = state.next, points = new Set();
  // An area with an owner is bordered by one colour alone (or by none on an
  // empty board, where no point touches both colours anyway).
  for (const { points: area, owner } of emptyRegions(board)) {
    if (owner) continue;
    for (const p of area) {
      const around = neighbors(p, size).map(n => board[n]);
      if (!around.includes(BLACK) || !around.includes(WHITE)) continue;
      const next = [...board]; next[p] = me;
      if (group(next, p).liberties.size >= 2) points.add(p);
    }
  }
  return points;
}

/**
 * KataGo's top legal move for the player to move, or null to pass. Eye-filling
 * moves are never chosen (they could only kill one's own group), nor are
 * points KataGo calls settled for either side: inside the opponent's area a
 * move is a ko threat or an invasion the estimate already rules out, inside
 * one's own it changes nothing. The one settled point still played is one's
 * own next to an opponent stone, which closes a border. A pass wins when its
 * logit is at least the best remaining move's, except that the mover first
 * fills the liberties of opponent stones its ownership calls dead, so the
 * playout really removes them, and then fills the dame that are not the
 * opponent's, so the count leaves no point open between the two sides.
 */
export function pickSettleMove(state, policy, passLogit, ownership = null) {
  if (state.status !== "playing" || !Array.isArray(policy) || policy.length !== state.board.length) return null;
  const board = state.board, me = state.next, size = sizeOf(board);
  const known = Array.isArray(ownership) && ownership.length === board.length;
  const mine = p => known ? me * ownership[p] : 0;
  const open = p => Math.abs(mine(p)) < OWNERSHIP_BANDS.SETTLED ||
    mine(p) >= OWNERSHIP_BANDS.SETTLED && neighbors(p, size).some(n => board[n] === -me);
  const order = policy.map((logit, p) => [logit, p])
    .filter(([logit, p]) => Number.isFinite(logit) && !board[p] && !ownEye(board, p, me))
    .sort((a, b) => b[0] - a[0]);
  // No move brings back a board seen before (positional superko), so captures
  // and recaptures cannot cycle, with single passes between them, for ever.
  const seen = new Set(state.history || []);
  const legal = p => { try { return !seen.has(boardHash(play(state, p).board)); } catch { return false; } };
  const targets = captureTargets(state, ownership);
  for (const [logit, p] of order) {
    if (Number.isFinite(passLogit) && passLogit >= logit) break;
    if (open(p) && legal(p)) return p;
  }
  // Rather than pass, take the best-rated point that closes in on dead stones.
  for (const [, p] of order) if (targets.has(p) && legal(p)) return p;
  const dame = damePoints(state);
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
