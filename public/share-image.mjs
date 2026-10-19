import { replaySteps } from "./sgf.mjs";
import { createGifAnimation } from "./gif-encoder.mjs";
import { ownershipPixel, showsOwnership } from "./territory-view.mjs";
import { boardTheme } from "./board-theme.mjs";
import { resultLabel, resultWinner } from "./result-label.mjs";
export { resultLabel };

// A shared image is a 4:5 card in the board's own colour, read top to bottom:
//   brand · moves and rules (small)  →  the result (the headline)  →  the
//   board  →  what the colours mean  →  where to play / where it is developed.
// Sizes are in 1/800ths of the card width.
const CARD_RATIO = 1.25;
const BOARD_X = 50, BOARD_Y = 128, BOARD = 700;
const MOVE_DELAY = 45, FIRST_DELAY = 90, LAST_DELAY = 350;
export const SHARE_LINKS = Object.freeze([
  ["自分でプレイする","miego.fun"],
  ["開発に参加する","github.com/KTakahiro1729/MieGO"]
]);
// Ink and its muted tone, per board look.
const INK = {wood:["#2e2416","rgba(46,36,22,.66)"],light:["#1d2127","rgba(29,33,39,.64)"],
  dark:["#eef3f8","rgba(238,243,248,.66)"]};
const MINCHO = "'Shippori Mincho', 'Hiragino Mincho ProN', 'Yu Mincho', 'Noto Serif JP', serif";
const GOTHIC = "'Zen Kaku Gothic New', 'Hiragino Sans', 'Noto Sans JP', system-ui, sans-serif";
const FONT_TEXT = "MieGO0123456789.+〜·全手目まで白黒の投了時間切れで差が勝利引き分け対局中子局コミ"+
  "地合いの推定自分でプレイする開発に参加abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ/:-";

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

/**
 * The card's words. `moves` counts the shown position ("42手目") or the
 * animation ("全42手", "20手目まで"); `rules` names komi and any handicap.
 */
export function shareLabels({step,total,result,animated,komi=7.5,handicap=0}) {
  const moves=!animated ? step+"手目" : step===total ? "全"+total+"手" : step+"手目まで";
  const rules=(handicap ? handicap+"子局 · " : "")+"コミ"+komi+"目";
  return {moves,rules,result:resultLabel(result)||"対局中",winner:resultWinner(result)};
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

// What the colours mean: a titled bar from White's area (left, with a white
// stone) to Black's (right, with a black stone), over the board colour.
function paintLegend(ctx,u,center,y,{palette,opacity,theme},muted) {
  const look=boardTheme(theme),w=220*u,h=8*u,x=center-w/2,steps=48;
  ctx.font="500 "+Math.round(14*u)+"px "+GOTHIC;ctx.fillStyle=muted;
  ctx.textAlign="center";ctx.fillText("地合いの推定",center,y-14*u);
  ctx.save();
  ctx.beginPath();ctx.roundRect?.(x,y-h/2,w,h,h/2);ctx.clip();
  ctx.fillStyle="rgb("+look.surface.join(",")+")";ctx.fillRect(x,y-h/2,w,h);
  for(let i=0;i<steps;i++) {
    const [r,g,b,a]=ownershipPixel(i/(steps-1)*2-1,palette,opacity,theme);
    ctx.fillStyle="rgba("+r+","+g+","+b+","+(a/255).toFixed(3)+")";
    ctx.fillRect(x+w*i/steps,y-h/2,w/steps+1,h);
  }
  ctx.restore();
  ctx.textBaseline="middle";
  paintStone(ctx,look,"W",x-18*u,y,8*u);
  ctx.fillStyle=muted;ctx.textAlign="right";ctx.fillText("白の地",x-34*u,y);
  paintStone(ctx,look,"B",x+w+18*u,y,8*u);
  ctx.fillStyle=muted;ctx.textAlign="left";ctx.fillText("黒の地",x+w+34*u,y);
  ctx.textBaseline="alphabetic";
}

/**
 * Draws the card onto `target` (sized by shareFrameSize). `board` is a board
 * canvas in the look `theme`; `legend` ({palette,opacity}) is drawn when the
 * image carries ownership colours.
 */
export function paintShareFrame(target,board,{moves,rules="",result,winner=null,theme,legend=null,boardSize=9}) {
  const {width,height}=shareFrameSize(target.width),u=width/800;
  const look=boardTheme(theme),[ink,muted]=INK[theme]||INK.wood;
  const ctx=target.getContext("2d");
  const bx=BOARD_X*u,by=BOARD_Y*u,bs=BOARD*u,center=width/2;
  // The board's own fill, laid out exactly as on the board and continued
  // past its edges, so the card reads as one surface.
  if(look.fill.length>1 && ctx.createLinearGradient) {
    const grad=ctx.createLinearGradient(bx,by,bx+bs,by+bs);
    look.fill.forEach((color,i)=>grad.addColorStop(i/(look.fill.length-1),color));
    ctx.fillStyle=grad;
  } else ctx.fillStyle=look.fill[0];
  ctx.fillRect(0,0,width,height);
  ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality="high";
  ctx.drawImage(board,bx,by,bs,bs);

  // The grid's outer lines sit one line spacing in from the board's edge.
  const left=bx+bs/(boardSize+1),right=bx+bs-bs/(boardSize+1);
  ctx.textBaseline="alphabetic";ctx.textAlign="left";
  ctx.font="700 "+Math.round(22*u)+"px Georgia, 'Times New Roman', serif";
  ctx.fillStyle=muted;ctx.fillText("MieGO",left,44*u);
  ctx.font="500 "+Math.round(16*u)+"px "+GOTHIC;
  ctx.textAlign="right";ctx.fillText(rules ? moves+" · "+rules : moves,right,43*u);

  // The headline: the result, centred with the winner's stone.
  ctx.font="800 "+Math.round(42*u)+"px "+MINCHO;
  const hasStone=winner==="B" || winner==="W",stone=hasStone ? 44*u : 0,room=right-left-stone;
  const textWidth=Math.min(ctx.measureText(result).width,room),start=center-(stone+textWidth)/2;
  if(hasStone)paintStone(ctx,look,winner,start+16*u,92*u,16*u);
  ctx.textAlign="left";ctx.fillStyle=ink;ctx.fillText(result,start+stone,106*u,room);

  if(legend && showsOwnership(legend.palette))paintLegend(ctx,u,center,866*u,{...legend,theme},muted);

  // The links use the board's full width, so a long address stays legible.
  ctx.fillStyle=muted;ctx.fillRect(bx,896*u,bs,Math.max(1,u));
  const column=bs/SHARE_LINKS.length;
  ctx.textAlign="center";
  SHARE_LINKS.forEach(([label,link],i)=>{
    const x=bx+column*(i+.5);
    ctx.font="700 "+Math.round(20*u)+"px "+GOTHIC;ctx.fillStyle=ink;ctx.fillText(link,x,936*u,column-12*u);
    ctx.font="500 "+Math.round(15*u)+"px "+GOTHIC;ctx.fillStyle=muted;ctx.fillText(label,x,964*u,column-12*u);
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
