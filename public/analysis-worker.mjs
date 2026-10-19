import { KOMI, whiteCompensation } from "./core.mjs";
import { influence } from "./influence.mjs";
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
