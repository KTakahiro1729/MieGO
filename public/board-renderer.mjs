import {
  BLACK,
  SIZE as DEFAULT_SIZE,
  WHITE,
  countingBoard,
  isGomoku,
  isJapanese,
  sizeOf,
  starPoints,
} from "./core.mjs";
import {
  countingOpacity,
  countingPalette,
  NEUTRAL_MARK,
  ownershipPixel,
  prisonerOutline,
  showsOwnership,
  shownOwnership,
} from "./territory-view.mjs";
import {boardTheme} from "./board-theme.mjs";
import {stoneForPreview} from "./board-preview.mjs";
import {scoringRegions,prisonerFill,prisonersFilled} from "./scoring-regions.mjs";

// Stones taken by a move fade out over this long instead of vanishing.
export const CAPTURE_FADE_MS=200;
const reducedMotion=()=>!!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// ドパガキモード: sparks fly from each taken stone, and a "+N" rises over them, for this long.
export const BURST_MS=900;
// Each placed stone sends out a ring for this long.
export const WAVE_MS=480;
const BURST_SPARKS=20;
const BURST_LIMIT=320;

/**
 * Draws the current board without modifying the match. Each draw reads one
 * consistent view from getView, including its provisional/replayed position.
 * The optional canvas factory and frame clock keep this module testable without a DOM.
 */
export function createBoardRenderer({canvas,getView,createOverlayCanvas=()=>document.createElement("canvas"),
  requestFrame=globalThis.requestAnimationFrame?.bind(globalThis),now=()=>performance.now(),
  stillMotion=reducedMotion,random=Math.random}) {
  const ctx = canvas.getContext("2d");
  const overlayCanvas = createOverlayCanvas();
  overlayCanvas.width = DEFAULT_SIZE;
  overlayCanvas.height = DEFAULT_SIZE;
  const overlayContext = overlayCanvas.getContext("2d");
  // The side length of the position being drawn; set at the start of each draw.
  let SIZE = DEFAULT_SIZE;
  // The live position last drawn and each stone's alpha in it, to find what a move captured.
  let lastLive=null, shownAlpha=[], fading=[], sparks=[], pops=[], waves=[], frame=null;

  function paintGrid(theme, d, gap, pad) {
    ctx.clearRect(0,0,d,d);
    if(theme.fill.length>1 && ctx.createLinearGradient) {
      const grad=ctx.createLinearGradient(0,0,d,d);
      theme.fill.forEach((color,i)=>grad.addColorStop(i/(theme.fill.length-1),color));
      ctx.fillStyle=grad;
    } else ctx.fillStyle = theme.fill[0];
    ctx.fillRect(0,0,d,d);
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 2;
    for(let i=0;i<SIZE;i++) {
      const p = pad+i*gap;
      ctx.beginPath();
      ctx.moveTo(pad,p);
      ctx.lineTo(d-pad,p);
      ctx.moveTo(p,pad);
      ctx.lineTo(p,d-pad);
      ctx.stroke();
    }
  }

  function paintOwnership(view, gap, pad) {
    const {game,boardReview,candidate,displayedOwnership,palette,opacity} = view;
    const values = boardReview ? boardReview.ownership : displayedOwnership;
    if(!boardReview && game.status!=="playing")return;
    // An estimate for another board size (e.g. just after switching) is skipped.
    if(!showsOwnership(palette) || !values || values.length!==SIZE*SIZE)return;
    const shown=boardReview ? boardReview.preview||boardReview.display : candidate||game;
    // Hidden stones would show through as clear points, so they keep their colour.
    paintOverlay(shownOwnership(shown.board,values,{japanese:isJapanese(shown) && !view.hideStones}),
      palette,opacity,gap,pad,true);
  }

  // One pixel per intersection, scaled up: smoothed for the estimate,
  // hard-edged cells for the count. The estimate gets a ring of transparent
  // pixels around it, so the smoothing fades it out past the outer lines
  // instead of stopping at a hard square edge.
  function paintOverlay(values,palette,opacity,gap,pad,smooth) {
    const border=smooth?1:0, width=SIZE+2*border;
    if(overlayCanvas.width!==width)overlayCanvas.width=overlayCanvas.height=width;
    const image = overlayContext.createImageData(width,width);
    for(let i=0;i<SIZE*SIZE;i++) {
      const [r,g,b,a] = ownershipPixel(values[i],palette,opacity);
      const p = ((Math.floor(i/SIZE)+border)*width+i%SIZE+border)*4;
      image.data[p]=r;
      image.data[p+1]=g;
      image.data[p+2]=b;
      image.data[p+3]=a;
    }
    overlayContext.putImageData(image,0,0);
    ctx.save();
    ctx.imageSmoothingEnabled=smooth;
    if(smooth)ctx.imageSmoothingQuality="high";
    const origin=pad-gap/2-gap*border;
    ctx.drawImage(overlayCanvas,origin,origin,gap*width,gap*width);
    ctx.restore();
  }

  function paintStarPoints(theme,gap,pad) {
    for(const point of starPoints(SIZE)) {
      const x=point%SIZE, y=Math.floor(point/SIZE);
      ctx.beginPath();
      ctx.arc(pad+x*gap,pad+y*gap,4,0,Math.PI*2);
      ctx.fillStyle=theme.star;
      ctx.fill();
    }
  }

  function paintStone(theme,color,x,y,r,alpha) {
    const look=color===BLACK?theme.stones.black:theme.stones.white;
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    if(theme.flatStones) ctx.fillStyle=look.outer;
    else {
      const grad=ctx.createRadialGradient(x-r*.3,y-r*.3,2,x,y,r*1.2);
      grad.addColorStop(0,look.inner);
      grad.addColorStop(1,look.outer);
      ctx.fillStyle=grad;
    }
    ctx.fill();
    ctx.strokeStyle=look.rim;
    ctx.lineWidth=1.5;
    ctx.stroke();
    ctx.restore();
  }

  // A filled-in stone that is not a real stone on the board: the AI's
  // provisional playout moves and the prisoners filled into territory.
  function paintFillStone(theme,color,x,y,gap) {
    paintStone(theme,color,x,y,gap*.3,.55);
  }

  /** 日本式: prisoners filled into territory, each block outlined in its counter colour. */
  function paintPrisonerFill(theme,fill,palette,gap,pad) {
    const outline=prisonerOutline(palette);
    for(const [key,color] of [["white",WHITE],["black",BLACK]]){
      const points=new Set(fill[key]);
      if(!points.size)continue;
      for(const i of points)paintFillStone(theme,color,pad+(i%SIZE)*gap,pad+Math.floor(i/SIZE)*gap,gap);
      // The block's outer edge: every cell side that does not touch another filled cell.
      ctx.save();
      ctx.strokeStyle=outline[key];ctx.lineWidth=Math.max(2,gap*.05);ctx.lineCap="round";
      ctx.beginPath();
      const h=gap/2;
      for(const i of points){
        const x=i%SIZE,y=Math.floor(i/SIZE),cx=pad+x*gap,cy=pad+y*gap;
        const has=(dx,dy)=>x+dx>=0&&x+dx<SIZE&&y+dy>=0&&y+dy<SIZE&&points.has(i+dx+dy*SIZE);
        if(!has(0,-1)){ctx.moveTo(cx-h,cy-h);ctx.lineTo(cx+h,cy-h);}
        if(!has(0,1)){ctx.moveTo(cx-h,cy+h);ctx.lineTo(cx+h,cy+h);}
        if(!has(-1,0)){ctx.moveTo(cx-h,cy-h);ctx.lineTo(cx-h,cy+h);}
        if(!has(1,0)){ctx.moveTo(cx+h,cy-h);ctx.lineTo(cx+h,cy+h);}
      }
      ctx.stroke();ctx.restore();
    }
  }

  // 日本式 counts territory only: points with a living stone or a filled-in
  // prisoner stay clear, and a dead stone's point is territory once lifted.
  function paintCountingArea(view,score,gap,pad,game,fill){
    const board=countingBoard(game),filled=new Set([...fill.black,...fill.white]);
    const counted=i=>!isJapanese(game) || !board[i] && !filled.has(i);
    const values=score.owned.map((owner,i)=>!counted(i)?0:owner===BLACK?1:owner===WHITE?-1:0);
    paintOverlay(values,countingPalette(view.palette),countingOpacity(view.opacity),gap,pad,false);
  }

  // Empty points that count for neither side get a small ring (not a dot,
  // which would read as a star point). The playout's fill stones count for
  // nobody under area scoring too, but they are drawn, so they need no ring.
  function paintNeutralPoints(game,score,kept,gap,pad){
    const dead=new Set(game.dead||[]),filled=new Set(kept.map(k=>k.position));
    ctx.save();
    ctx.strokeStyle=NEUTRAL_MARK;ctx.lineWidth=Math.max(1.5,gap*.035);
    for(let i=0;i<score.owned.length;i++){
      if(score.owned[i] || (game.board[i] && !dead.has(i)) || filled.has(i))continue;
      ctx.beginPath();
      ctx.arc(pad+(i%SIZE)*gap,pad+Math.floor(i/SIZE)*gap,gap*.13,0,Math.PI*2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function paintRegionLabels(regions,gap,pad){
    const fontSize=Math.max(18,Math.round(gap*.36));
    for(const region of regions){
      const index=region.position;
      if(!Number.isInteger(index))continue;
      const x=pad+(index%SIZE)*gap,y=pad+Math.floor(index/SIZE)*gap;
      const label=String(region.count);
      // The label always sits on a stone or marker of the region's colour,
      // so plain text in the opposite tone is legible without a box or halo.
      ctx.save();
      ctx.font="600 "+fontSize+"px Inter, system-ui, -apple-system, sans-serif";
      ctx.textAlign="center";ctx.textBaseline="middle";
      ctx.fillStyle=region.color===BLACK?"#f6efdc":"#2a2f31";
      ctx.fillText(label,x,y+1);ctx.restore();
    }
  }
  function paintStones(theme, view, display, gap, pad) {
    const {game,boardReview,candidate,illegalCandidate} = view;
    // "Stones hidden" leaves only the ownership colours (and the move being
    // placed) while playing or replaying; counting shows every stone again.
    const hidden = !!view.hideStones && (!!boardReview || game.status==="playing");
    const proposedBoard = boardReview?.preview?.board || (boardReview ? null : candidate?.board);
    const preview = boardReview ? boardReview.previewPosition :
      (candidate?.moves.at(-1)?.position ?? illegalCandidate?.position);
    for(let i=0;i<display.board.length;i++) {
      const {color:committedColor,captured} = stoneForPreview(display.board, proposedBoard, i);
      // A forbidden point is selectable, but the stone is never committed.
      const color=!boardReview && illegalCandidate?.position===i && display.board[i]===0
        ? game.next : committedColor;
      if(!color || hidden && i!==preview)continue;
      // Dead stones are off the board once the count is final, or filled under Japanese rules.
      if(!boardReview && (game.status==="finished" && !game.result?.endsWith("+R") ||
         prisonersFilled(game)) && game.dead?.includes(i))continue;
      const x=pad+(i%SIZE)*gap;
      const y=pad+Math.floor(i/SIZE)*gap;
      const r=gap*.44;
      const alpha=captured ? 0.4 : i===preview ? 0.68 : 1;
      shownAlpha[i]=alpha;
      paintStone(theme,color,x,y,r,alpha);

      if(i===preview) {
        ctx.save();
        ctx.strokeStyle="#f5d58b";
        ctx.lineWidth=3;
        ctx.setLineDash([7,5]);
        ctx.beginPath();
        ctx.arc(x,y,r+4,0,Math.PI*2);
        ctx.stroke();
        ctx.restore();
      }
      if(!boardReview && game.status==="scoring" && game.dead.includes(i)) {
        ctx.strokeStyle="#d95a4e";
        ctx.lineWidth=4;
        ctx.beginPath();
        ctx.moveTo(x-r*.45,y-r*.45);
        ctx.lineTo(x+r*.45,y+r*.45);
        ctx.moveTo(x+r*.45,y-r*.45);
        ctx.lineTo(x-r*.45,y+r*.45);
        ctx.stroke();
      }
    }
  }

  // The last move: a ring inside the stone in the opposite tone, so it shows
  // on either colour and on every board size. Sized like OGS's (radius 0.3
  // of a point) so it is still found on 19路 on a phone. With the stones
  // hidden it is drawn in the mover's own colour instead.
  function paintMoveMark(theme,color,stoneShown,x,y,gap) {
    const black=color===BLACK;
    const tone=black===stoneShown?theme.stones.white.inner:theme.stones.black.outer;
    ctx.save();
    ctx.strokeStyle=tone;
    ctx.lineWidth=Math.max(3,gap*.09);
    ctx.beginPath();
    ctx.arc(x,y,gap*.28,0,Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }

  function paintLastMove(theme,view,display,gap,pad) {
    const {game,boardReview,candidate,illegalCandidate,lastPosition} = view;
    const marker=boardReview?display.moves.at(-1)?.position:lastPosition;
    if(Number.isInteger(marker) && display.board[marker] && (boardReview||(!candidate && !illegalCandidate && game.status==="playing"))) {
      const hidden=!!view.hideStones && (!!boardReview || game.status==="playing");
      paintMoveMark(theme,display.board[marker],!hidden,pad+(marker%SIZE)*gap,pad+Math.floor(marker/SIZE)*gap,gap);
    }
  }

  // 自由に置く: the chosen point gets a gold ring until a button below says what goes there.
  function paintFreePick(position,gap,pad) {
    ctx.save();
    ctx.strokeStyle="#f2c875";
    ctx.lineWidth=Math.max(3,gap*.08);
    ctx.beginPath();
    ctx.arc(pad+(position%SIZE)*gap,pad+Math.floor(position/SIZE)*gap,gap*.47,0,Math.PI*2);
    ctx.stroke();
    ctx.restore();
  }

  // While the player edits カスタム's colours on an empty board, a few stones
  // in the middle (the last with its move mark) show the chosen stone colours.
  // They are only painted: the game and its record never hold them.
  function paintSampleStones(theme,gap,pad) {
    const c=Math.floor(SIZE/2), r=gap*.44;
    const stones=[[c-1,c-1,BLACK],[c,c-1,WHITE],[c-1,c,WHITE],[c,c,BLACK],[c+1,c,WHITE]];
    for(const [x,y,color] of stones)paintStone(theme,color,pad+x*gap,pad+y*gap,r,1);
    const [x,y,color]=stones.at(-1);
    paintMoveMark(theme,color,true,pad+x*gap,pad+y*gap,gap);
  }

  // A live move that removed stones starts them fading from the alpha they were last shown at.
  // ドパガキモード ("on") also rings out from the placed stone and sends
  // rainbow sparks out of each taken one, more and farther the more were taken.
  function noteCaptures(game,live,burst) {
    const before=lastLive;
    lastLive=live?{board:[...game.board],moves:game.moves.length,alpha:shownAlpha}:null;
    if(!live || !before || before.board.length!==game.board.length || game.moves.length!==before.moves+1 ||
       !requestFrame || stillMotion())return;
    const start=now();
    const taken=[];
    for(let i=0;i<game.board.length;i++){
      if(before.board[i] && !game.board[i] && before.alpha[i]){
        fading.push({position:i,color:before.board[i],from:before.alpha[i],start});
        taken.push(i);
      }
      if(burst==="on" && !before.board[i] && game.board[i])waves.push({x:i%SIZE,y:Math.floor(i/SIZE),start});
    }
    if(burst!=="on" || !taken.length)return;
    const each=Math.max(3,Math.min(BURST_SPARKS,Math.floor(BURST_LIMIT/taken.length)));
    const reach=Math.min(4,1.4+taken.length*.2);
    for(const position of taken)
      for(let k=0;k<each;k++){
        const angle=random()*Math.PI*2, speed=(.4+random()*.6)*reach;
        sparks.push({x:position%SIZE,y:Math.floor(position/SIZE),dx:Math.cos(angle)*speed,dy:Math.sin(angle)*speed,
          hue:Math.floor(random()*360),start});
      }
    const mid=axis=>taken.reduce((sum,p)=>sum+axis(p),0)/taken.length;
    pops.push({x:mid(p=>p%SIZE),y:mid(p=>Math.floor(p/SIZE)),count:taken.length,start});
  }
  function paintFading(theme,gap,pad) {
    const time=now();
    fading=fading.filter(f=>time-f.start<CAPTURE_FADE_MS);
    for(const f of fading)
      paintStone(theme,f.color,pad+(f.position%SIZE)*gap,pad+Math.floor(f.position/SIZE)*gap,gap*.44,
        f.from*(1-(time-f.start)/CAPTURE_FADE_MS));
    if(fading.length && frame===null)frame=requestFrame(()=>{frame=null;draw();});
  }
  function paintSparks(gap,pad) {
    const time=now();
    sparks=sparks.filter(s=>time-s.start<BURST_MS);
    pops=pops.filter(s=>time-s.start<BURST_MS);
    waves=waves.filter(s=>time-s.start<WAVE_MS);
    ctx.save();
    for(const w of waves){
      const p=(time-w.start)/WAVE_MS;
      ctx.globalAlpha=(1-p)*.9;
      ctx.strokeStyle="#f0c773";
      ctx.lineWidth=gap*.12*(1-p)+1;
      ctx.beginPath();
      ctx.arc(pad+w.x*gap,pad+w.y*gap,gap*(.45+1.4*p),0,Math.PI*2);
      ctx.stroke();
    }
    for(const s of sparks){
      const p=(time-s.start)/BURST_MS, out=1-(1-p)**2;
      ctx.globalAlpha=1-p;
      ctx.fillStyle="hsl("+s.hue+" 95% 62%)";
      ctx.beginPath();
      ctx.arc(pad+(s.x+s.dx*out)*gap,pad+(s.y+s.dy*out)*gap,gap*.13*(1-p*.5),0,Math.PI*2);
      ctx.fill();
    }
    for(const s of pops){
      const p=(time-s.start)/BURST_MS, grow=Math.min(1,p*6);
      ctx.globalAlpha=p<.7?1:(1-p)/.3;
      ctx.font="900 "+Math.round(gap*(.6+.25*Math.min(s.count,8)/8)*(.6+.4*grow))+"px sans-serif";
      ctx.textAlign="center";
      ctx.textBaseline="middle";
      const x=pad+s.x*gap, y=pad+(s.y-.4-p*1.2)*gap;
      ctx.fillStyle="#5a3a12";
      ctx.fillText("+"+s.count,x+2,y+3);
      ctx.fillStyle="#f0c773";
      ctx.fillText("+"+s.count,x,y);
    }
    ctx.restore();
    if((sparks.length || pops.length || waves.length) && frame===null)frame=requestFrame(()=>{frame=null;draw();});
  }

  function draw() {
    const view=getView();
    const {game,boardReview}=view;
    const display=boardReview?.display||game;
    SIZE=sizeOf(display.board);
    const theme=boardTheme(view.boardTheme);
    const d=canvas.width, gap=d/(SIZE+1), pad=gap;
    paintGrid(theme,d,gap,pad);
    paintOwnership(view,gap,pad);
    // 五目並べ ends without a count, like a resignation.
    const scoredFinished=game.status==="finished" && !game.result?.endsWith("+R") && !isGomoku(game);
    // Stones kept from the settle playout, and the prisoners filled around them.
    const kept=!boardReview && Array.isArray(view.keptPlayout) ? view.keptPlayout : [];
    const counting=!boardReview && (game.status==="scoring" || scoredFinished);
    const fill=counting?prisonerFill(game,{avoid:new Set(kept.map(k=>k.position))}):null;
    const scoring=counting?scoringRegions(game,prisonersFilled(game)?
      {prisonerPoints:new Set([...fill.black,...fill.white])}:{}):null;
    if(scoring)paintCountingArea(view,scoring,gap,pad,game,fill);
    paintStarPoints(theme,gap,pad);
    if(scoring)paintNeutralPoints(game,scoring,kept,gap,pad);
    const live=!boardReview && game.status==="playing";
    if(!live){fading=[];sparks=[];pops=[];waves=[];}
    shownAlpha=[];
    paintStones(theme,view,display,gap,pad);
    noteCaptures(game,live,view.burst);
    if(fading.length)paintFading(theme,gap,pad);
    for(const {position,color} of kept)
      paintFillStone(theme,color,pad+(position%SIZE)*gap,pad+Math.floor(position/SIZE)*gap,gap);
    if(scoring)paintPrisonerFill(theme,fill,view.palette,gap,pad);
    if(scoring)paintRegionLabels(scoring.regions,gap,pad);
    paintLastMove(theme,view,display,gap,pad);
    if(!view.boardReview && Number.isInteger(view.freePick))paintFreePick(view.freePick,gap,pad);
    if(sparks.length || pops.length || waves.length)paintSparks(gap,pad);
    if(view.sampleStones && !counting && !view.candidate && !view.illegalCandidate && display.board.every(v=>!v))
      paintSampleStones(theme,gap,pad);
  }
  return {draw};
}
