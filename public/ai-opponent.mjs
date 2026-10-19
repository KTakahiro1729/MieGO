import { play, neighbors, group, SIZE } from "./core.mjs";

// Validate neural candidates with the application's own move rules (ko and suicide).
export function legalAiMoves(state) {
  if (state.status !== "playing") return [];
  const legal = [];
  for (let p = 0; p < SIZE * SIZE; p++) {
    if (state.board[p]) continue;
    try { play(state, p); legal.push(p); } catch {}
  }
  return legal;
}

export function choosePolicyMove(state, logits, passLogit, options = {}) {
  if (state.status !== "playing") throw new Error("対局中ではありません");
  const legal = legalAiMoves(state);
  if (legal.length === 0 || state.moveNumber >= 145) return null;
  if (!logits || logits.length !== SIZE * SIZE) throw new Error("KataGoの着手方針が不正です");

  const temperature = Math.max(0.05, Math.min(2, Number(options.temperature) || 0.4));
  const random = options.random || Math.random;
  const candidates = legal.filter(p => Number.isFinite(logits[p]))
    .map(p => ({ position:p, score:logits[p] }));
  if (!candidates.length) throw new Error("有効なKataGo着手候補がありません");

  // No premature passes in the opening. Respect neural pass logits in later play.
  if (Number.isFinite(passLogit) && (state.moveNumber >= 58 ||
      (state.passes === 1 && state.moveNumber >= 18))) {
    candidates.push({ position:null, score:passLogit - 0.3 });
  }
  const best = Math.max(...candidates.map(c => c.score));
  const weights = candidates.map(c => Math.exp((c.score - best) / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let sample = Math.max(0, Math.min(1 - Number.EPSILON, Number(random()))) * total;
  for (let i = 0; i < candidates.length; i++) {
    sample -= weights[i];
    if (sample <= 0) return candidates[i].position;
  }
  return candidates[candidates.length - 1].position;
}

export function chooseFallbackMove(state, random = Math.random) {
  if (state.status !== "playing") throw new Error("対局中ではありません");
  const legal = legalAiMoves(state);
  if (!legal.length || state.moveNumber >= 120) return null;
  const opponent = -state.next;
  let bestScore = -Infinity;
  let best = null;
  for (const point of legal) {
    const next = play(state, point);
    const captured = state.board.filter(v => v === opponent).length -
      next.board.filter(v => v === opponent).length;
    const liberties = group(next.board, point).liberties.size;
    const adjacent = neighbors(point).filter(p => state.board[p] !== 0);
    const eyePenalty = !captured && adjacent.length > 0 &&
      adjacent.every(p => state.board[p] === state.next) ? 5 : 0;
    const score = captured * 10 + Math.min(liberties, 4) * .35 -
      eyePenalty + Number(random()) * .5;
    if (score > bestScore) { bestScore = score; best = point; }
  }
  if (state.moveNumber >= 75 && bestScore < .8) return null;
  return best;
}
