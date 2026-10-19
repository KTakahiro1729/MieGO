import { SIZE, BLACK, WHITE } from "./core.mjs";

// A coordinate-free 9x9 diagram used by all AI handoffs.
const GLYPHS={ [BLACK]:"●",[WHITE]:"○",0:"・" };
export const AI_BOARD_LEGEND="●=黒、○=白、・=空点。上の行から下の行へ9路ずつ表示します。";
export const AI_SELECTED_POINT="◇=打とうとした空点";

export function formatBoardForAi(board,{selectedPosition=null}={}) {
  if(!Array.isArray(board)||board.length!==SIZE*SIZE ||
     !board.every(n=>n===BLACK||n===WHITE||n===0))throw Error("盤面データが不正です");
  if(selectedPosition!==null && (!Number.isInteger(selectedPosition) ||
     selectedPosition<0 || selectedPosition>=SIZE*SIZE || board[selectedPosition]!==0))
    throw Error("指定した空点が不正です");
  const rows=[];
  for(let y=0;y<SIZE;y++){
    rows.push(board.slice(y*SIZE,(y+1)*SIZE).map((stone,x)=>
      y*SIZE+x===selectedPosition?"◇":GLYPHS[stone]).join(" "));
  }
  return rows.join("\n");
}
