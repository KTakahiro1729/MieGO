import {SIZE as DEFAULT_SIZE, BLACK, WHITE, isFree, isGomoku, sizeOf, starPoints} from "./core.mjs";
import {
  countingOpacity,
  countingPalette,
  NEUTRAL_MARK,
  ownershipPixel,
  prisonerOutline,
  showsOwnership,
} from "./territory-view.mjs";
import {boardTheme} from "./board-theme.mjs";
import {stoneForPreview} from "./board-preview.mjs";
import {libertyMarks} from "./liberty-view.mjs";
import {scoringRegions,prisonerFill,prisonersFilled} from "./scoring-regions.mjs";

// Stones taken by a move fade out over this long instead of vanishing.
export const CAPTURE_FADE_MS=200;
const reducedMotion=()=>!!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
// ドパガキモード's burst: sparks fly from each taken stone for this long.
export const BURST_MS=650;
const BURST_SPARKS={on:7,ultra:12};
const BURST_LIMIT={on:70,ultra:160};

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
  let lastLive=null, shownAlpha=[], fading=[], sparks=[], frame=null;

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
    const {game,boardReview,displayedOwnership,palette,opacity} = view;
    const values = boardReview ? boardReview.ownership : displayedOwnership;
    if(!boardReview && game.status!=="playing")return;
    // An estimate for another board size (e.g. just after switching) is skipped.
    if(!showsOwnership(palette) || !values || values.length!==SIZE*SIZE)return;
    paintOverlay(values,palette,opacity,gap,pad,true);
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

  function paintCountingArea(view,score,gap,pad){
    const values=score.owned.map(owner=>owner===BLACK?1:owner===WHITE?-1:0);
    paintOverlay(values,countingPalette(view.palette),countingOpacity(view.opacity),gap,pad,false);
  }

  // Empty points that count for neither side get a small ring (not a dot,
  // which would read as a star point).
  function paintNeutralPoints(game,score,gap,pad){
    const dead=new Set(game.dead||[]);
    ctx.save();
    ctx.strokeStyle=NEUTRAL_MARK;ctx.lineWidth=Math.max(1.5,gap*.035);
    for(let i=0;i<score.owned.length;i++){
      if(score.owned[i] || (game.board[i] && !dead.has(i)))continue;
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
    if(view.linkStones && !hidden)paintStoneLinks(theme,proposedBoard||display.board,gap,pad);
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

  // つながった石を一つに描く: a bar under each pair of same-coloured stones
  // that touch along a line, so a connected group reads as one shape and a
  // diagonal pair stays apart.
  function paintStoneLinks(theme,board,gap,pad) {
    // Shaded white stones are lighter in the middle than at the edge; the
    // bar takes the colour between, so it neither glows nor greys.
    const mid=(a,b)=>/^#[0-9a-f]{6}$/i.test(a+b.slice(1))?"#"+[1,3,5].map(k=>
      Math.round((parseInt(a.slice(k,k+2),16)+parseInt(b.slice(k,k+2),16))/2).toString(16).padStart(2,"0")).join(""):a;
    const white=theme.stones.white;
    const tone={[BLACK]:theme.stones.black.outer,[WHITE]:theme.flatStones?white.inner:mid(white.inner,white.outer)};
    ctx.save();
    ctx.lineCap="butt";ctx.lineWidth=gap*.6;
    for(let i=0;i<board.length;i++){
      const color=board[i];
      if(color!==BLACK && color!==WHITE)continue;
      const x=pad+(i%SIZE)*gap,y=pad+Math.floor(i/SIZE)*gap;
      for(const [dx,dy,j] of [[1,0,i+1],[0,1,i+SIZE]]){
        if(dx && i%SIZE===SIZE-1 || j>=board.length || board[j]!==color)continue;
        ctx.strokeStyle=tone[color];
        ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+dx*gap,y+dy*gap);ctx.stroke();
      }
    }
    ctx.restore();
  }

  // 呼吸点の表示 on the board being played or replayed: the provisional
  // board while a stone is placed, otherwise the shown position.
  const ATARI_MARK="#d95a4e";
  function paintLiberties(theme,view,display,gap,pad) {
    const {game,boardReview,candidate}=view;
    if(!view.liberties || view.liberties==="off" || isGomoku(game) || isFree(game))return;
    if(!boardReview && game.status!=="playing" || view.hideStones)return;
    const board=boardReview?boardReview.preview?.board||display.board:candidate?.board||game.board;
    const placed=boardReview?boardReview.preview?.board && boardReview.previewPosition:
      candidate?.moves.at(-1)?.position;
    const tone={[BLACK]:theme.stones.black.outer,[WHITE]:theme.stones.white.inner};
    const xy=i=>[pad+(i%SIZE)*gap,pad+Math.floor(i/SIZE)*gap];
    for(const mark of libertyMarks(board,view.liberties,placed)){
      const [x,y]=xy(mark.position);
      ctx.save();
      if(mark.kind==="dot"){
        const r=gap*.12;
        if(mark.atari || mark.colors.length===1){
          ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
          ctx.fillStyle=mark.atari?ATARI_MARK:tone[mark.colors[0]];ctx.fill();
        }else{
          // A liberty both colours share: half of each.
          ctx.beginPath();ctx.arc(x,y,r,Math.PI/2,Math.PI*3/2);ctx.fillStyle=tone[BLACK];ctx.fill();
          ctx.beginPath();ctx.arc(x,y,r,-Math.PI/2,Math.PI/2);ctx.fillStyle=tone[WHITE];ctx.fill();
        }
        ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
        ctx.strokeStyle=mark.colors[0]===WHITE && mark.colors.length===1 && !mark.atari?tone[BLACK]:"rgba(255,255,255,.75)";
        ctx.lineWidth=Math.max(1,gap*.025);ctx.stroke();
      }else if(mark.kind==="atari"){
        ctx.beginPath();ctx.arc(x,y,gap*.2,0,Math.PI*2);
        ctx.strokeStyle=ATARI_MARK;ctx.lineWidth=Math.max(2.5,gap*.07);ctx.stroke();
      }else if(mark.kind==="count"){
        ctx.font="700 "+Math.max(11,Math.round(gap*.4))+"px Inter, system-ui, -apple-system, sans-serif";
        ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillStyle=mark.count===1?(mark.color===BLACK?"#ff8a7a":"#c0392b"):
          mark.color===BLACK?"#f6efdc":"#2a2f31";
        ctx.fillText(String(mark.count),x,y+1);
      }
      ctx.restore();
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
  // ドパガキモード ("on" or "ultra") also sends sparks out of each, more and
  // farther the more stones the move took; ULTRA's are rainbow-coloured.
  function noteCaptures(game,live,burst) {
    const before=lastLive;
    lastLive=live?{board:[...game.board],moves:game.moves.length,alpha:shownAlpha}:null;
    if(!live || !before || before.board.length!==game.board.length || game.moves.length!==before.moves+1 ||
       !requestFrame || stillMotion())return;
    const start=now();
    const taken=[];
    for(let i=0;i<game.board.length;i++)
      if(before.board[i] && !game.board[i] && before.alpha[i]){
        fading.push({position:i,color:before.board[i],from:before.alpha[i],start});
        taken.push(i);
      }
    if(!BURST_SPARKS[burst] || !taken.length)return;
    const each=Math.max(2,Math.min(BURST_SPARKS[burst],Math.floor(BURST_LIMIT[burst]/taken.length)));
    const reach=Math.min(3,1+taken.length*.15);
    for(const position of taken)
      for(let k=0;k<each;k++){
        const angle=random()*Math.PI*2, speed=(.4+random()*.6)*reach;
        sparks.push({x:position%SIZE,y:Math.floor(position/SIZE),dx:Math.cos(angle)*speed,dy:Math.sin(angle)*speed,
          hue:burst==="ultra"?Math.floor(random()*360):null,start});
      }
  }
  function paintSparks(gap,pad) {
    const time=now();
    sparks=sparks.filter(s=>time-s.start<BURST_MS);
    ctx.save();
    for(const s of sparks){
      const p=(time-s.start)/BURST_MS, out=1-(1-p)**2;
      ctx.globalAlpha=1-p;
      ctx.fillStyle=s.hue===null?"#f0c773":"hsl("+s.hue+" 90% 62%)";
      ctx.beginPath();
      ctx.arc(pad+(s.x+s.dx*out)*gap,pad+(s.y+s.dy*out)*gap,gap*.09*(1-p*.5),0,Math.PI*2);
      ctx.fill();
    }
    ctx.restore();
    if(sparks.length && frame===null)frame=requestFrame(()=>{frame=null;draw();});
  }
  function paintFading(theme,gap,pad) {
    const time=now();
    fading=fading.filter(f=>time-f.start<CAPTURE_FADE_MS);
    for(const f of fading)
      paintStone(theme,f.color,pad+(f.position%SIZE)*gap,pad+Math.floor(f.position/SIZE)*gap,gap*.44,
        f.from*(1-(time-f.start)/CAPTURE_FADE_MS));
    if(fading.length && frame===null)frame=requestFrame(()=>{frame=null;draw();});
  }

  /**
   * 決着手順: KataGo's playout over the real position. Stones it adds are
   * provisional, drawn as small translucent fill stones; real stones it captured
   * stay as faint ghosts with a red cross, the way they will be marked dead.
   */
  function paintSettle(theme,view,gap,pad) {
    const {board,base,last,ownership}=view.settle;
    if(ownership && ownership.length===board.length && showsOwnership(view.palette))
      paintOverlay(ownership,view.palette,view.opacity,gap,pad,true);
    paintStarPoints(theme,gap,pad);
    const r=gap*.44;
    for(let i=0;i<board.length;i++){
      const x=pad+(i%SIZE)*gap,y=pad+Math.floor(i/SIZE)*gap;
      if(board[i]){
        if(board[i]===base[i])paintStone(theme,board[i],x,y,r,1);
        else paintFillStone(theme,board[i],x,y,gap);
      }else if(base[i]){
        paintStone(theme,base[i],x,y,r,.28);
        ctx.save();ctx.strokeStyle="#d95a4e";ctx.lineWidth=3;ctx.beginPath();
        ctx.moveTo(x-r*.4,y-r*.4);ctx.lineTo(x+r*.4,y+r*.4);
        ctx.moveTo(x+r*.4,y-r*.4);ctx.lineTo(x-r*.4,y+r*.4);ctx.stroke();ctx.restore();
      }
    }
    if(Number.isInteger(last) && board[last])
      paintMoveMark(theme,board[last],true,pad+(last%SIZE)*gap,pad+Math.floor(last/SIZE)*gap,gap);
  }

  function draw() {
    const view=getView();
    const {game,boardReview}=view;
    if(view.settle && !boardReview){
      SIZE=sizeOf(view.settle.board);
      const theme=boardTheme(view.boardTheme), d=canvas.width, gap=d/(SIZE+1);
      paintGrid(theme,d,gap,gap);
      paintSettle(theme,view,gap,gap);
      return;
    }
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
    if(scoring)paintCountingArea(view,scoring,gap,pad);
    paintStarPoints(theme,gap,pad);
    if(scoring)paintNeutralPoints(game,scoring,gap,pad);
    const live=!boardReview && game.status==="playing";
    if(!live){fading=[];sparks=[];}
    shownAlpha=[];
    paintStones(theme,view,display,gap,pad);
    noteCaptures(game,live,view.burst);
    if(fading.length)paintFading(theme,gap,pad);
    paintLiberties(theme,view,display,gap,pad);
    for(const {position,color} of kept)
      paintFillStone(theme,color,pad+(position%SIZE)*gap,pad+Math.floor(position/SIZE)*gap,gap);
    if(scoring)paintPrisonerFill(theme,fill,view.palette,gap,pad);
    if(scoring)paintRegionLabels(scoring.regions,gap,pad);
    paintLastMove(theme,view,display,gap,pad);
    if(sparks.length)paintSparks(gap,pad);
    if(view.sampleStones && !counting && !view.candidate && !view.illegalCandidate && display.board.every(v=>!v))
      paintSampleStones(theme,gap,pad);
  }
  return {draw};
}
