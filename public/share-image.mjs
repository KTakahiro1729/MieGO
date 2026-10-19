import { replaySteps } from "./sgf.mjs";
import { createGifAnimation } from "./gif-encoder.mjs";

// Shared images carry a footer under the board: the move and result, then
// where to play and where the project is developed.
const FOOTER_RATIO = 0.25;
export const SHARE_LINKS = Object.freeze([
  ["自分でプレイする：","miego.fun"],
  ["開発に参加する：","github.com/KTakahiro1729/MieGO"]
]);
const MOVE_DELAY = 45, FIRST_DELAY = 90, LAST_DELAY = 350;

const COLOR = {B:"黒",W:"白"};
/** Japanese wording for an SGF-style result such as "B+3.5" or "W+R". */
export function resultLabel(result) {
  if(typeof result!=="string" || !result)return null;
  if(/^(0|Draw|Jigo)$/i.test(result))return "引き分け";
  const match=/^([BW])\+(.*)$/.exec(result);
  if(!match)return null;
  const [,side,detail]=match;
  if(/^R(esign)?$/i.test(detail))return COLOR[side]+"の投了勝ち";
  if(/^T(ime)?$/i.test(detail))return COLOR[side]+"の時間勝ち";
  if(/^\d+(\.\d+)?$/.test(detail))return COLOR[side]+"の"+Number(detail).toFixed(1)+"目勝ち";
  return COLOR[side]+"の勝ち";
}

export function shareCaption({step,total,result,animated}) {
  const moves=animated ? (step===total ? "全"+total+"手" : "0〜"+step+"手目") : step+"手目";
  return moves+" · "+(resultLabel(result)||"終局前");
}

export function shareFrameSize(boardSize) {
  const footer=Math.round(boardSize*FOOTER_RATIO);
  return {width:boardSize,height:boardSize+footer,footer};
}

/** Draws the board scaled to `target`'s width, with the footer below it. */
export function paintShareFrame(target,board,{caption}) {
  const {width,footer}=shareFrameSize(target.width);
  const ctx=target.getContext("2d");
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  ctx.drawImage(board,0,0,width,width);
  ctx.fillStyle="#0e1119";
  ctx.fillRect(0,width,width,footer);
  const x=Math.round(width*.045);
  ctx.textBaseline="middle";ctx.textAlign="left";
  ctx.fillStyle="#f1f0ed";
  ctx.font="700 "+Math.round(footer*.2)+"px system-ui, sans-serif";
  ctx.fillText(caption,x,width+footer*.25,width-x*2);
  ctx.font="500 "+Math.round(footer*.125)+"px system-ui, sans-serif";
  SHARE_LINKS.forEach(([label,link],i)=>{
    const y=width+footer*(.58+i*.24),labelWidth=ctx.measureText(label).width;
    ctx.fillStyle="#aeb3be";ctx.fillText(label,x,y);
    ctx.fillStyle="#e5c47a";ctx.fillText(link,x+labelWidth,y,width-x*2-labelWidth);
  });
}

/**
 * Replays `snapshot` from the start up to `step`, one frame per move, and
 * ends on `finalBoard` (the board exactly as currently drawn). `renderBoard`
 * draws a replayed position, with its ownership colours, at `size` pixels.
 * Yields to the page between frames so the UI stays responsive.
 */
export async function buildGameAnimation({snapshot,step,size,renderBoard,finalBoard,createCanvas,caption,
  onProgress=()=>{},pause=()=>new Promise(resolve=>setTimeout(resolve,0))}) {
  const {width,height}=shareFrameSize(size);
  const frame=createCanvas(width,height);
  const pixels=board=>{
    paintShareFrame(frame,board,{caption});
    return frame.getContext("2d").getImageData(0,0,width,height).data.slice();
  };
  const at=i=>i===step ? pixels(finalBoard) : pixels(renderBoard(replaySteps(snapshot,i)));
  // Ownership colours change every move, so sample the palette across the game.
  const samples=[...new Set([0,step>>2,step>>1,(step*3)>>2,step])].map(at);
  const gif=createGifAnimation({width,height,paletteFrom:samples});
  for(let i=0;i<=step;i++) {
    gif.addFrame(i===step ? samples.at(-1) : i===0 ? samples[0] : at(i),
      i===step ? LAST_DELAY : i===0 ? FIRST_DELAY : MOVE_DELAY);
    onProgress(i,step);
    await pause();
  }
  return gif.finish();
}
