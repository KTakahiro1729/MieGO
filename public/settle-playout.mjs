import { BLACK, WHITE, group, neighbors, play, resume, sizeOf } from "./core.mjs";

/**
 * 決着手順: before the dead stones are marked, KataGo plays the position out
 * with its best (policy) moves until both sides pass, so that dead stones are
 * actually captured on a scratch copy. The match itself never changes; the
 * playout only proposes which stones are dead and is shown as an animation.
 */

/** At most this many playout moves: a third of the board (27, 56 or 120). */
export const settleLimit = size => Math.round(size * size / 3);

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
  const board = state.board, me = state.next, targets = new Set(), seen = new Set();
  if (!Array.isArray(ownership) || ownership.length !== board.length) return targets;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== -me || seen.has(i)) continue;
    const { stones, liberties } = group(board, i);
    for (const s of stones) seen.add(s);
    const control = [...stones].map(s => me * ownership[s]);
    if (control.every(v => v >= 0.7) && control.reduce((a, b) => a + b, 0) / control.length >= 0.85)
      for (const p of liberties) targets.add(p);
  }
  return targets;
}

/**
 * KataGo's top legal move for the player to move, or null to pass. Eye-filling
 * moves are never chosen (they could only kill one's own group). A pass wins
 * when its logit is at least the best remaining move's, except that the mover
 * first fills the liberties of opponent stones its ownership calls dead, so
 * the playout really removes them.
 */
export function pickSettleMove(state, policy, passLogit, ownership = null) {
  if (state.status !== "playing" || !Array.isArray(policy) || policy.length !== state.board.length) return null;
  const order = policy.map((logit, p) => [logit, p])
    .filter(([logit, p]) => Number.isFinite(logit) && !state.board[p] && !ownEye(state.board, p, state.next))
    .sort((a, b) => b[0] - a[0]);
  const legal = p => { try { play(state, p); return true; } catch { return false; } };
  const targets = captureTargets(state, ownership);
  for (const [logit, p] of order) {
    if (Number.isFinite(passLogit) && passLogit >= logit) break;
    if (legal(p)) return p;
  }
  // Rather than pass, take the best-rated point that closes in on dead stones.
  for (const [, p] of order) if (targets.has(p) && legal(p)) return p;
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
  const board = original.board, dead = new Set(), seen = new Set();
  const valid = Array.isArray(ownership) && ownership.length === board.length &&
    ownership.every(Number.isFinite);
  for (let i = 0; i < board.length; i++) {
    const color = board[i];
    if ((color !== BLACK && color !== WHITE) || seen.has(i)) continue;
    const stones = [...group(board, i).stones];
    for (const s of stones) seen.add(s);
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
  if (!Array.isArray(positions) || positions.length > settleLimit(size) + 2) return null;
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
