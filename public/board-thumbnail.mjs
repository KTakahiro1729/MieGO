import {BLACK, WHITE, starPoints} from "./core.mjs";
import {BOARD_CUSTOM, boardTheme} from "./board-theme.mjs";
import {ownershipPixel} from "./territory-view.mjs";

const PAD = 5, SPAN = 80, END = PAD+SPAN;
const num = v => +v.toFixed(2);

/**
 * Static SVG markup of a saved position for the library list. The markup is
 * built only from validated numbers, so it is safe to assign as innerHTML.
 * Every board size shares one 90x90 view box; spacing scales with the size.
 * overlay {ownership,palette,opacity} tints each point as the board does.
 */
export function boardThumbnailSvg(board, lastPosition=null, themeName, overlay=null) {
  const size=Math.sqrt(board.length);
  const theme=boardTheme(themeName);
  // The custom board's own stone colours; the fixed looks keep their tuned ones.
  const stoneFill=themeName===BOARD_CUSTOM ?
    {black:theme.stones.black.outer,white:theme.stones.white.inner,whiteRim:theme.stones.white.rim} :
    {black:"#1c2427",white:"#f8f6ee",whiteRim:"#8e8a80"};
  const gap=SPAN/(size-1), k=gap/10;
  const point=i=>[num(PAD+(i%size)*gap), num(PAD+Math.floor(i/size)*gap)];
  const parts=[`<rect width="${END+PAD}" height="${END+PAD}" rx="4" fill="rgb(${theme.surface.join(",")})"/>`];
  let lines="";
  for(let i=0;i<size;i++) {
    const p=num(PAD+i*gap);
    lines+=`M${PAD} ${p}H${END}M${p} ${PAD}V${END}`;
  }
  parts.push(`<path d="${lines}" stroke="${theme.line}" stroke-width="${num(Math.max(.4,.8*k))}"/>`);
  for(const star of starPoints(size)) {
    const [cx,cy]=point(star);
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${num(Math.max(.8,1.3*k))}" fill="${theme.line}"/>`);
  }
  const ownership=overlay?.ownership;
  if(Array.isArray(ownership) && ownership.length===board.length) {
    for(let i=0;i<board.length;i++) {
      const value=Number(ownership[i]);
      if(!Number.isFinite(value))continue;
      const [r,g,b,a]=ownershipPixel(value,overlay.palette,overlay.opacity);
      if(!a)continue;
      const [cx,cy]=point(i);
      parts.push(`<rect x="${num(cx-gap/2)}" y="${num(cy-gap/2)}" width="${num(gap)}" height="${num(gap)}" fill="rgb(${r},${g},${b})" fill-opacity="${num(a/255)}"/>`);
    }
  }
  for(let i=0;i<board.length;i++) {
    const color=board[i];
    if(color!==BLACK && color!==WHITE)continue;
    const [cx,cy]=point(i);
    parts.push(color===BLACK ?
      `<circle cx="${cx}" cy="${cy}" r="${num(4.6*k)}" fill="${stoneFill.black}" stroke="${theme.stones.black.rim}" stroke-width="${num(.6*k)}"/>` :
      `<circle cx="${cx}" cy="${cy}" r="${num(4.4*k)}" fill="${stoneFill.white}" stroke="${stoneFill.whiteRim}" stroke-width="${num(.6*k)}"/>`);
  }
  if(Number.isInteger(lastPosition) && lastPosition>=0 && lastPosition<board.length &&
     board[lastPosition]!==0) {
    const [cx,cy]=point(lastPosition), half=1.8*k;
    parts.push(`<rect x="${num(cx-half)}" y="${num(cy-half)}" width="${num(2*half)}" height="${num(2*half)}" fill="#d0b25c"/>`);
  }
  return `<svg viewBox="0 0 ${END+PAD} ${END+PAD}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${parts.join("")}</svg>`;
}

/** The final board of a record, marked with its last on-board move. */
export function recordThumbnailSvg(record, themeName, overlay=null) {
  // A trailing pass or resignation leaves no stone to mark.
  const last=record.snapshot.moves.at(-1)?.position;
  return boardThumbnailSvg(record.snapshot.board,Number.isInteger(last)?last:null,themeName,overlay);
}
