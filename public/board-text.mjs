import { SIZE, BLACK, WHITE } from "./core.mjs";

// Human-readable ASCII coordinates, and a consistent one-character-per-point
// black/white board for AI handoffs. Never include invitation credentials.
const columns="ABCDEFGHJ";
const GLYPHS={ [BLACK]:"●",[WHITE]:"○",0:"・" };
export const AI_BOARD_LEGEND="●=黒、○=白、・=空点。列はA〜H・J、行は上から9〜1。";

export function formatBoardForAi(board) {
  if(!Array.isArray(board)||board.length!==SIZE*SIZE ||
     !board.every(n=>n===BLACK||n===WHITE||n===0))throw Error("盤面データが不正です");
  const rows=["    "+columns.split("").join(" ")];
  for(let y=0;y<SIZE;y++){
    rows.push(String(SIZE-y).padStart(2," ")+"  "+
      board.slice(y*SIZE,(y+1)*SIZE).map(n=>GLYPHS[n]).join(" "));
  }
  return rows.join("\n");
}
