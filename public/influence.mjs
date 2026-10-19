import { SIZE, BLACK, group } from "./core.mjs";

// A quick stone-influence estimate of ownership, -1 (white) to 1 (black).
// It stands in where no KataGo estimate exists: replayed positions and the
// fallback analysis worker.
export function influence(board) {
  const output = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < board.length; i++) {
    if (board[i]) { output[i] = board[i]; continue; }
    let black = 0, white = 0;
    for (let j = 0; j < board.length; j++) {
      if (!board[j]) continue;
      const dx = i % SIZE - j % SIZE, dy = Math.floor(i / SIZE) - Math.floor(j / SIZE);
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > 6) continue;
      const liberties = group(board, j).liberties.size;
      const strength = (liberties === 1 ? .35 : 1) / Math.pow(dist + .65, 1.65);
      if (board[j] === BLACK) black += strength;
      else white += strength;
    }
    output[i] = Math.tanh((black - white) * 1.15);
  }
  return [...output];
}
