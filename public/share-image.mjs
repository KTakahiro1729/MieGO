import { replaySteps } from "./sgf.mjs";
import { createGifAnimation } from "./gif-encoder.mjs";

import { ownershipPixel, showsOwnership } from "./territory-view.mjs";
import { boardTheme } from "./board-theme.mjs";

// A shared image is a 4:5 card made of the board itself: the board fills the
// top and its surface continues below. The board's top margin carries the
// brand, the result (centred, with the winner's stone) and the move count;
// the ownership legend sits centred just under the board; below a rule, each
// link is a centred column with the address on top and its purpose beneath.
// Sizes are in 1/800ths of the card width; the grid edge is at 80.
const CARD_RATIO = 1.25, EDGE = 80;
const MOVE_DELAY = 45, FIRST_DELAY = 90, LAST_DELAY = 350;
export const SHARE_LINKS = Object.freeze([
  ["自分でプレイする","miego.fun"],
  ["開発に参加する","github.com/KTakahiro1729/MieGO"]
]);
// Ink and its muted tone, per board look.
const INK = {wood:["#2e2416","rgba(46,36,22,.62)"],light:["#1d2127","rgba(29,33,39,.6)"],
  dark:["#eef3f8","rgba(238,243,248,.62)"]};
const MINCHO = "'Shippori Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', serif";
const GOTHIC = "'Zen Kaku Gothic New', 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif";
const FONT_TEXT = "MieGO0123456789.+〜·全手目白黒の勝ち投了時間引き分け終局前が差で利自分でプレイする開発に参加寄り"+
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ/:-";

/** Loads the card's two typefaces (subset to its text); falls back to system fonts. */
let fontsReady=null;
export function loadShareFonts(doc=globalThis.document,timeout=3000) {
  if(!doc?.fonts || !doc.head)return Promise.resolve();
  // fonts.load() settles at once while the stylesheet has not yet declared
  // the faces, so wait for the stylesheet before asking for the fonts.
  fontsReady??=new Promise((resolve,reject)=>{
    const link=Object.assign(doc.createElement("link"),{rel:"stylesheet",onload:resolve,onerror:reject,
      href:"https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@800&family=Zen+Kaku+Gothic+New:wght@500;700"+
        "&display=swap&text="+encodeURIComponent(FONT_TEXT)});
    doc.head.append(link);
  }).then(()=>Promise.all(["800 44px 'Shippori Mincho'","500 16px 'Zen Kaku Gothic New'",
    "700 16px 'Zen Kaku Gothic New'"].map(font=>doc.fonts.load(font,"白黒全手"))));
  return Promise.race([fontsReady,new Promise(resolve=>setTimeout(resolve,timeout))]).catch(()=>{});
}

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
  if(/^\d+(\.\d+)?$/.test(detail))return COLOR[side]+"が"+Number(detail).toFixed(1)+"目差で勝利";
  return COLOR[side]+"の勝ち";
}

export function shareLabels({step,total,result,animated}) {
  const moves=animated ? (step===total ? "全"+total+"手" : "0〜"+step+"手目") : step+"手目";
  const label=resultLabel(result);
  const winner=label && label!=="引き分け" ? result[0] : null;
  return {moves,result:label||"終局前",winner};
}

export const shareFrameSize = width => ({width,height:Math.round(width*CARD_RATIO)});

function paintStone(ctx,theme,color,x,y,r) {
  const look=color==="B" ? theme.stones.black : theme.stones.white;
  ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
  if(theme.flatStones || !ctx.createRadialGradient)ctx.fillStyle=look.outer;
  else {
    const grad=ctx.createRadialGradient(x-r*.3,y-r*.3,1,x,y,r*1.2);
    grad.addColorStop(0,look.inner);grad.addColorStop(1,look.outer);
    ctx.fillStyle=grad;
  }
  ctx.fill();
  ctx.strokeStyle=look.rim;ctx.lineWidth=1.2;ctx.stroke();
}

// White-leaning on the left, Black-leaning on the right, over the board colour,
// centred on `center` with its labels either side of the bar.
function paintLegend(ctx,u,center,y,{palette,opacity,theme},muted) {
  const w=200*u,h=8*u,x=center-w/2,steps=48;
  ctx.save();
  ctx.beginPath();ctx.roundRect?.(x,y-h/2,w,h,h/2);ctx.clip();
  ctx.fillStyle="rgb("+boardTheme(theme).surface.join(",")+")";ctx.fillRect(x,y-h/2,w,h);
  for(let i=0;i<steps;i++) {
    const [r,g,b,a]=ownershipPixel(i/(steps-1)*2-1,palette,opacity,theme);
    ctx.fillStyle="rgba("+r+","+g+","+b+","+(a/255).toFixed(3)+")";
    ctx.fillRect(x+w*i/steps,y-h/2,w/steps+1,h);
  }
  ctx.restore();
  ctx.font="500 "+Math.round(14*u)+"px "+GOTHIC;ctx.fillStyle=muted;ctx.textBaseline="middle";
  ctx.textAlign="right";ctx.fillText("白寄り",x-12*u,y);
  ctx.textAlign="left";ctx.fillText("黒寄り",x+w+12*u,y);
  ctx.textBaseline="alphabetic";
}

/**
 * Draws the card onto `target` (sized by shareFrameSize). `board` is a board
 * canvas in the look `theme`; `legend` ({palette,opacity}) is drawn when the
 * image carries ownership colours.
 */
export function paintShareFrame(target,board,{moves,result,winner=null,theme,legend=null}) {
  const {width,height}=shareFrameSize(target.width),u=width/800;
  const look=boardTheme(theme),[ink,muted]=INK[theme]||INK.wood;
  const ctx=target.getContext("2d");
  // The board's own fill, continued below it so the card reads as one surface.
  if(look.fill.length>1 && ctx.createLinearGradient) {
    const grad=ctx.createLinearGradient(0,0,width,width);
    look.fill.forEach((color,i)=>grad.addColorStop(i/(look.fill.length-1),color));
    ctx.fillStyle=grad;
  } else ctx.fillStyle=look.fill[0];
  ctx.fillRect(0,0,width,height);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  ctx.drawImage(board,0,0,width,width);

  const left=EDGE*u,right=width-EDGE*u,center=width/2;
  ctx.textBaseline="alphabetic";ctx.textAlign="left";
  ctx.font="700 "+Math.round(22*u)+"px Georgia, 'Times New Roman', serif";
  ctx.fillStyle=muted;ctx.fillText("MieGO",left,52*u);
  ctx.font="500 "+Math.round(18*u)+"px "+GOTHIC;
  ctx.textAlign="right";ctx.fillText(moves,right,51*u);

  // The result, centred between the brand and the move count.
  ctx.font="800 "+Math.round(36*u)+"px "+MINCHO;
  const hasStone=winner==="B" || winner==="W",stone=hasStone ? 38*u : 0,room=420*u-stone;
  const textWidth=Math.min(ctx.measureText(result).width,room),start=center-(stone+textWidth)/2;
  if(hasStone)paintStone(ctx,look,winner,start+14*u,42*u,14*u);
  ctx.textAlign="left";ctx.fillStyle=ink;ctx.fillText(result,start+stone,55*u,room);

  if(legend && showsOwnership(legend.palette))paintLegend(ctx,u,center,828*u,{...legend,theme},muted);

  ctx.fillStyle=muted;ctx.fillRect(left,868*u,right-left,Math.max(1,u));
  const column=(right-left)/SHARE_LINKS.length;
  ctx.textAlign="center";
  SHARE_LINKS.forEach(([label,link],i)=>{
    const x=left+column*(i+.5);
    ctx.font="700 "+Math.round(19*u)+"px "+GOTHIC;ctx.fillStyle=ink;ctx.fillText(link,x,920*u,column-16*u);
    ctx.font="500 "+Math.round(14*u)+"px "+GOTHIC;ctx.fillStyle=muted;ctx.fillText(label,x,948*u,column-16*u);
  });
  ctx.textAlign="left";
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
