import { BLACK, WHITE, isBoardSize } from "./core.mjs";

// A coordinate-free diagram (9x9, 13x13 or 19x19) used by all AI handoffs.
const GLYPHS={ [BLACK]:"●",[WHITE]:"○",0:"・" };
export const AI_BOARD_LEGEND="●=黒、○=白、・=空点。上の行から下の行へ1行ずつ表示します。";
export const AI_SELECTED_POINT="◇=打とうとした空点";

export function formatBoardForAi(board,{selectedPosition=null}={}) {
  const SIZE=Math.sqrt(board?.length);
  if(!Array.isArray(board)||!isBoardSize(SIZE) ||
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

/** The legend, a heading and the diagram, in the order every AI handoff uses. */
export function formatBoardSection(heading,board,{selectedPosition=null}={}) {
  const legend=selectedPosition===null?AI_BOARD_LEGEND:AI_BOARD_LEGEND+" "+AI_SELECTED_POINT;
  return [legend,"",heading+"：",formatBoardForAi(board,{selectedPosition})].join("\n");
}
