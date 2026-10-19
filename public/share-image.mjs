import { replaySteps } from "./sgf.mjs";
import { createGifAnimation } from "./gif-encoder.mjs";

import { ownershipPixel, showsOwnership } from "./territory-view.mjs";
import { boardTheme } from "./board-theme.mjs";

// A shared image is a 4:5 card: the brand and move count above the board,
// the result and the ownership-colour legend below it, then where to play
// and where the project is developed. Sizes are in 1/720ths of the width.
const CARD_RATIO = 1.25, MARGIN = 36, BOARD_TOP = 78, BOARD = 648;
const MOVE_DELAY = 45, FIRST_DELAY = 90, LAST_DELAY = 350;
export const SHARE_LINKS = Object.freeze([
  ["自分でプレイする：","miego.fun"],
  ["開発に参加する：","github.com/KTakahiro1729/MieGO"]
]);

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

export function shareLabels({step,total,result,animated}) {
  const moves=animated ? (step===total ? "全"+total+"手" : "0〜"+step+"手目") : step+"手目";
  return {moves,result:resultLabel(result)||"終局前"};
}

export const shareFrameSize = width => ({width,height:Math.round(width*CARD_RATIO)});
/** The card width that shows a board canvas of `boardSize` pixels at full size. */
export const shareCardWidth = boardSize => Math.round(boardSize*720/BOARD);

function roundedRect(ctx,x,y,w,h,r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}

// White-leaning on the left, Black-leaning on the right, over the board colour.
function paintLegend(ctx,u,right,y,{palette,opacity,theme}) {
  const w=168*u,h=10*u,x=right-w;
  const [r,g,b]=boardTheme(theme).surface;
  ctx.save();
  roundedRect(ctx,x,y-h/2,w,h,h/2);ctx.clip();
  ctx.fillStyle="rgb("+r+","+g+","+b+")";ctx.fillRect(x,y-h/2,w,h);
  const steps=48;
  for(let i=0;i<steps;i++) {
    const [cr,cg,cb,ca]=ownershipPixel(i/(steps-1)*2-1,palette,opacity,theme);
    ctx.fillStyle="rgba("+cr+","+cg+","+cb+","+(ca/255).toFixed(3)+")";
    ctx.fillRect(x+w*i/steps,y-h/2,w/steps+1,h);
  }
  ctx.restore();
  ctx.font="500 "+Math.round(13*u)+"px system-ui, sans-serif";ctx.fillStyle="#aeb3be";
  ctx.textBaseline="top";
  ctx.textAlign="left";ctx.fillText("白寄り",x,y+h/2+6*u);
  ctx.textAlign="right";ctx.fillText("黒寄り",right,y+h/2+6*u);
}

/**
 * Draws the card onto `target` (sized by shareFrameSize): `board` is scaled
 * into the frame; `legend` ({palette,opacity,theme}) is drawn when the
 * ownership colours are shown.
 */
export function paintShareFrame(target,board,{moves,result,legend=null}) {
  const {width,height}=shareFrameSize(target.width),u=width/720;
  const ctx=target.getContext("2d");
  const background=ctx.createLinearGradient?.(0,0,0,height);
  if(background){background.addColorStop(0,"#1b2132");background.addColorStop(1,"#0d1018");}
  ctx.fillStyle=background||"#11151f";
  ctx.fillRect(0,0,width,height);
  const left=MARGIN*u,right=width-MARGIN*u;

  ctx.textBaseline="middle";ctx.textAlign="left";
  ctx.font="700 "+Math.round(34*u)+"px Georgia, 'Times New Roman', serif";
  ctx.fillStyle="#f1f0ed";ctx.fillText("Mie",left,40*u);
  ctx.fillStyle="#e5c47a";ctx.fillText("GO",left+ctx.measureText("Mie").width,40*u);
  ctx.font="600 "+Math.round(20*u)+"px system-ui, sans-serif";
  ctx.fillStyle="#aeb3be";ctx.textAlign="right";ctx.fillText(moves,right,42*u);

  const top=BOARD_TOP*u,size=BOARD*u;
  ctx.save();
  roundedRect(ctx,left,top,size,size,14*u);ctx.clip();
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  ctx.drawImage(board,left,top,size,size);
  ctx.restore();

  const resultY=top+size+42*u;
  ctx.textAlign="left";ctx.fillStyle="#f1f0ed";
  ctx.font="800 "+Math.round(32*u)+"px system-ui, sans-serif";
  ctx.fillText(result,left,resultY,legend && showsOwnership(legend.palette) ? size-196*u : size);
  if(legend && showsOwnership(legend.palette))paintLegend(ctx,u,right,resultY-6*u,legend);

  ctx.fillStyle="#2c3344";ctx.fillRect(left,resultY+30*u,size,Math.max(1,u));
  ctx.font="500 "+Math.round(17*u)+"px system-ui, sans-serif";
  SHARE_LINKS.forEach(([label,link],i)=>{
    const y=resultY+58*u+i*28*u,labelWidth=ctx.measureText(label).width;
    ctx.textAlign="left";
    ctx.fillStyle="#8d93a1";ctx.fillText(label,left,y);
    ctx.fillStyle="#e5c47a";ctx.fillText(link,left+labelWidth,y,size-labelWidth);
  });
}

/**
 * Replays `snapshot` from the start up to `step`, one frame per move, and
 * ends on `finalBoard` (the board exactly as currently drawn). `size` is the
 * card width; `renderBoard` draws a replayed position with its ownership colours.
 * Yields to the page between frames so the UI stays responsive.
 */
export async function buildGameAnimation({snapshot,step,size,renderBoard,finalBoard,createCanvas,labels,
  onProgress=()=>{},pause=()=>new Promise(resolve=>setTimeout(resolve,0))}) {
  const {width,height}=shareFrameSize(size);
  const frame=createCanvas(width,height);
  const pixels=board=>{
    paintShareFrame(frame,board,labels);
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
