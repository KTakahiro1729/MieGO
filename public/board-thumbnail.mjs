import {SIZE, BLACK, WHITE} from "./core.mjs";
import {boardTheme} from "./board-theme.mjs";

const STAR_POINTS = [[2,2],[6,2],[4,4],[2,6],[6,6]];
const GAP = 10, PAD = 5, END = PAD+(SIZE-1)*GAP;

/**
 * Static SVG markup of a saved position for the library list. The markup is
 * built only from validated numbers, so it is safe to assign as innerHTML.
 */
export function boardThumbnailSvg(board, lastPosition=null, themeName) {
  if(!Array.isArray(board) || board.length!==SIZE*SIZE)throw Error("盤面データが不正です");
  const theme=boardTheme(themeName);
  const parts=[`<rect width="${END+PAD}" height="${END+PAD}" rx="4" fill="rgb(${theme.surface.join(",")})"/>`];
  let lines="";
  for(let i=0;i<SIZE;i++) {
    const p=PAD+i*GAP;
    lines+=`M${PAD} ${p}H${END}M${p} ${PAD}V${END}`;
  }
  parts.push(`<path d="${lines}" stroke="${theme.line}" stroke-width=".8"/>`);
  for(const [x,y] of STAR_POINTS)
    parts.push(`<circle cx="${PAD+x*GAP}" cy="${PAD+y*GAP}" r="1.3" fill="${theme.line}"/>`);
  for(let i=0;i<SIZE*SIZE;i++) {
    const color=board[i];
    if(color!==BLACK && color!==WHITE)continue;
    const cx=PAD+(i%SIZE)*GAP, cy=PAD+Math.floor(i/SIZE)*GAP;
    parts.push(color===BLACK ?
      `<circle cx="${cx}" cy="${cy}" r="4.6" fill="#1c2427" stroke="${theme.stones.black.rim}" stroke-width=".6"/>` :
      `<circle cx="${cx}" cy="${cy}" r="4.4" fill="#f8f6ee" stroke="#8e8a80" stroke-width=".6"/>`);
  }
  if(Number.isInteger(lastPosition) && lastPosition>=0 && lastPosition<SIZE*SIZE &&
     board[lastPosition]!==0) {
    const cx=PAD+(lastPosition%SIZE)*GAP, cy=PAD+Math.floor(lastPosition/SIZE)*GAP;
    parts.push(`<rect x="${cx-1.8}" y="${cy-1.8}" width="3.6" height="3.6" fill="#d0b25c"/>`);
  }
  return `<svg viewBox="0 0 ${END+PAD} ${END+PAD}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${parts.join("")}</svg>`;
}

/** The final board of a record, marked with its last on-board move. */
export function recordThumbnailSvg(record, themeName) {
  // A trailing pass or resignation leaves no stone to mark.
  const last=record.snapshot.moves.at(-1)?.position;
  return boardThumbnailSvg(record.snapshot.board,Number.isInteger(last)?last:null,themeName);
}
