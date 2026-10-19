import { BLACK, WHITE, neighbors, group, KOMI, whiteCompensation, sizeOf } from "./core.mjs";
function influence(board) {
  const SIZE = sizeOf(board), output = new Float32Array(board.length);
  // Liberties per stone are computed once; 19x19 would otherwise repeat the
  // group search for every empty point.
  const liberties = board.map((stone, j) => stone ? group(board, j).liberties.size : 0);
  for (let i = 0; i < board.length; i++) {
    if (board[i]) { output[i] = board[i]; continue; }
    let black = 0, white = 0;
    for (let j = 0; j < board.length; j++) {
      if (!board[j]) continue;
      const dx = i % SIZE - j % SIZE, dy = Math.floor(i / SIZE) - Math.floor(j / SIZE);
      const dist = Math.abs(dx) + Math.abs(dy);
      if (dist > 6) continue;
      const strength = (liberties[j] === 1 ? .35 : 1) / Math.pow(dist + .65, 1.65);
      if (board[j] === BLACK) black += strength;
      else white += strength;
    }
    output[i] = Math.tanh((black - white) * 1.15);
  }
  return [...output];
}
self.onmessage = e => {
  const { id, board, state } = e.data;
  const ownership = influence(board);
  let black = 0, white = state ? whiteCompensation(state) : KOMI;
  for (let i = 0; i < ownership.length; i++) {
    const v = ownership[i];
    black += (1 + v) / 2;
    white += (1 - v) / 2;
  }
  self.postMessage({ id, ownership, black, white, lead: black - white });
};
