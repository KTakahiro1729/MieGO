import {
  BLACK,
  countedEnd,
  countingBoard,
  group,
  isFree,
  isGomoku,
  isJapanese,
  neighbors,
  SIZE as DEFAULT_SIZE,
  sizeOf,
  starPoints,
  WHITE,
} from "./core.mjs";
import {
  countingOpacity,
  countingPalette,
  NEUTRAL_MARK,
  ownershipPixel,
  paletteAt,
  prisonerOutline,
  showsOwnership,
  shownOwnership,
} from "./territory-view.mjs";
import {boardTheme} from "./board-theme.mjs";
import {stoneForPreview} from "./board-preview.mjs";
import {scoringRegions,prisonerFill,prisonersFilled} from "./scoring-regions.mjs";

// Stones taken by a move fade out over this long instead of vanishing.
export const CAPTURE_FADE_MS=200;
// 盤の線 breathes: every BREATH_MS each side takes one breath, about fifteen
// a minute as a person at rest, black in the first half and white in the
// second, so only one side moves at a time. Each breath is drawn in: first a
// faint wide circle around every liberty closes in on it, faster and denser
// as it goes, over BREATH_GATHER_MS; then over BREATH_DRAW_MS a stretch of
// line leaves the liberties slowly and speeds up into that side's groups,
// trailing what it covered in the last BREATH_TRAIL_MS, so it stretches as
// it speeds up, until it has passed the deepest stone. Then that side rests.
// Each group starts its breath up to BREATH_STAGGER_MS late, so the groups
// of a side breathe a little apart; all are done before the other side starts.
export const BREATH_MS=4000, BREATH_GATHER_MS=900, BREATH_DRAW_MS=900, BREATH_TRAIL_MS=250, BREATH_STAGGER_MS=200;
// How late a group breathes, from its first stone: steps of the golden
// ratio keep neighbouring groups well apart, and a group keeps its delay
// until a stone before its first joins it.
export const breathDelay=first=>(first*.6180339887%1)*BREATH_STAGGER_MS;
// 盤の線 on, a group a move takes dies from its last liberty out: the line
// through it is cut at the stone that fills that liberty and the cut runs
// one stone further each CAPTURE_STEP_MS (quicker in a long group, so it
// takes at most CAPTURE_SPREAD_MS), each stone fading as the cut reaches it.
// It runs while the move is only placed, the stones fading to
// PREVIEW_CAPTURED_ALPHA; once played they fade out from there as any
// capture does. A move played without being placed first is cut as it is played.
export const CAPTURE_STEP_MS=160, CAPTURE_SPREAD_MS=560, PREVIEW_CAPTURED_ALPHA=.4;
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
  let lastLive=null, shownAlpha=[], fading=[], cuts=[], previewCut=null, sparks=[], pops=[], waves=[], frame=null;

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
    const {game,boardReview,candidate,displayedOwnership,endedTerritory,palette,opacity} = view;
    const values = boardReview ? boardReview.ownership : displayedOwnership;
    if(!boardReview && game.status!=="playing" && !endedTerritory)return;
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
  function paintStones(theme, view, display, gap, pad, cut) {
    const {game,boardReview,candidate,illegalCandidate} = view;
    // "Stones hidden" leaves only the ownership colours (and the move being
    // placed) while playing or replaying; counting shows every stone again.
    const hidden = !!view.hideStones && (!!boardReview || game.status==="playing");
    const proposedBoard = boardReview?.preview?.board || (boardReview ? null : candidate?.board);
    const preview = boardReview ? boardReview.previewPosition :
      (candidate?.moves.at(-1)?.position ?? illegalCandidate?.position);
    const capturedAlpha=previewCapture(display,boardReview?null:candidate,cut);
    // 盤の線 reads the stones as shown, the one being placed included.
    const around=Array(display.board.length).fill(0);
    for(let i=0;i<display.board.length;i++) {
      const {color:committedColor,captured} = stoneForPreview(display.board, proposedBoard, i);
      // A forbidden point is selectable, but the stone is never committed.
      const color=!boardReview && illegalCandidate?.position===i && display.board[i]===0
        ? game.next : committedColor;
      if(!color || hidden && i!==preview)continue;
      // Dead stones are off the board once the count is final, or filled under Japanese rules.
      if(!boardReview && (countedEnd(game) ||
         prisonersFilled(game)) && game.dead?.includes(i))continue;
      const x=pad+(i%SIZE)*gap;
      const y=pad+Math.floor(i/SIZE)*gap;
      const r=gap*.44;
      const alpha=captured ? capturedAlpha(i) : i===preview ? 0.68 : 1;
      shownAlpha[i]=alpha;
      paintStone(theme,color,x,y,r,alpha);
      if(!captured)around[i]=color;

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
    // 盤の線 shows always, or only while a stone is being placed.
    const lines=view.linkStones==="always" || view.linkStones==="candidate" && !!proposedBoard;
    if(lines && !hidden){
      const moving=(boardReview || game.status==="playing") && !isGomoku(game) && !isFree(game) &&
        requestFrame && !stillMotion();
      paintBoardLines(view,around,gap,pad,moving);
    }
  }

  // 盤の線: a line runs through each group, along the board's
  // lines from stone to stone and out toward every empty point next to it,
  // narrowing to a point on it, so a group shows what holds it
  // together and the points it needs. Standing still these lines are dashes.
  // While playing there are no dashes: each breath starts as a circle closing
  // in on every liberty, and is drawn into the group as a stretch
  // of solid line. A group in atari gets its breath only as far as the edge
  // of its stone, so nothing behind it is ever reached. Each side keeps its own colour on the colour map.
  function paintBoardLines(view,board,gap,pad,moving) {
    const palette=countingPalette(view.palette);
    const rgb={[BLACK]:paletteAt(1,palette).join(","),[WHITE]:paletteAt(-1,palette).join(",")};
    const tone={[BLACK]:`rgb(${rgb[BLACK]})`,[WHITE]:`rgb(${rgb[WHITE]})`};
    const width=Math.max(2,gap*.08), dash=gap*.09, edge=1-.44, flare=gap*.14;
    // How far into its breath each side is: black and white take turns. A
    // group is later by its own delay; before it starts it is still resting.
    const since={[BLACK]:now()%BREATH_MS,[WHITE]:(now()+BREATH_MS/2)%BREATH_MS};
    const after=(color,delay)=>((since[color]-delay)%BREATH_MS+BREATH_MS)%BREATH_MS;
    const xy=i=>[pad+(i%SIZE)*gap,pad+Math.floor(i/SIZE)*gap];
    const dots=new Map(), seen=new Set(), groups=[], deepest={[BLACK]:0,[WHITE]:0};
    for(let i=0;i<board.length;i++){
      if(!board[i] || seen.has(i))continue;
      const color=board[i], g=group(board,i);
      for(const s of g.stones)seen.add(s);
      // How far each stone is from air: 1 next to a liberty, 2 behind that.
      const depth=new Map();
      let front=[...g.stones].filter(s=>neighbors(s,SIZE).some(n=>!board[n]));
      for(const s of front)depth.set(s,1);
      while(front.length){
        const next=[];
        for(const s of front)for(const n of neighbors(s,SIZE))
          if(g.stones.has(n) && !depth.has(n)){depth.set(n,depth.get(s)+1);next.push(n);}
        front=next;
      }
      for(const d of depth.values())deepest[color]=Math.max(deepest[color],d);
      // Each line runs from a (a liberty at depth 0, or a stone) to stone b.
      const lines=[], delay=breathDelay(Math.min(...g.stones));
      for(const s of g.stones)for(const n of neighbors(s,SIZE)){
        if(!board[n]){
          lines.push({a:n,b:s,from:0,to:depth.get(s),liberty:true});
          const key=n*3+color;
          if(!dots.has(key))dots.set(key,{point:n,color,first:delay,last:delay});
          const dot=dots.get(key);
          dot.first=Math.min(dot.first,delay);dot.last=Math.max(dot.last,delay);
        }else if(g.stones.has(n) && n>s)lines.push({a:s,b:n,from:depth.get(s),to:depth.get(n),liberty:false});
      }
      groups.push({color,g,lines,delay});
    }
    // How far a group's breath has run, and where its tail is, in lines
    // from the liberties. It sets out from the liberties the moment its
    // circles have closed in, and its tail is past the side's deepest stone
    // when the breath is over, so every group of a side draws in as fast.
    const breath=({color,delay})=>{
      if(!moving)return [0,0];
      const t=after(color,delay)-BREATH_GATHER_MS, run=BREATH_DRAW_MS-BREATH_TRAIL_MS;
      const reached=t=>t>0?(deepest[color]+1)*(t/run)**2:0;
      return [reached(t-BREATH_TRAIL_MS),reached(t)];
    };
    ctx.save();
    ctx.lineWidth=width;ctx.lineCap="butt";
    for(const group of groups){
      const {color,g,lines}=group, [near,ahead]=breath(group);
      const reach=g.liberties.size===1?1-.44:Infinity;
      for(const line of lines){
        const [ax,ay]=xy(line.a),[bx,by]=xy(line.b);
        const along=(u,v)=>{if(v>u){ctx.moveTo(ax+(bx-ax)*u,ay+(by-ay)*u);ctx.lineTo(ax+(bx-ax)*v,ay+(by-ay)*v);}};
        ctx.save();
        if(line.liberty){
          // Toward a liberty the line flares out of the stone's edge and
          // narrows to its own width on the liberty, as wide as the circle
          // that closes in there; over the stone it keeps its width.
          const at=(u,side)=>[ax+(bx-ax)*u+(ay-by)/gap*side,ay+(by-ay)*u+(bx-ax)/gap*side];
          const outline=[[0,width/2],[edge,flare/2],[edge,width/2],[1,width/2],[1,-width/2],[edge,-width/2],[edge,-flare/2],[0,-width/2]];
          ctx.beginPath();
          outline.forEach(([u,side],k)=>ctx[k?"lineTo":"moveTo"](...at(u,side)));
          ctx.closePath();ctx.clip();
          ctx.lineWidth=flare;
        }
        ctx.strokeStyle=tone[color];
        // Standing still the line shows as dashes; they start at the stone
        // so they line up through the group.
        if(!moving){
          ctx.globalAlpha=.75;ctx.setLineDash([dash,dash]);ctx.lineDashOffset=0;
          ctx.beginPath();ctx.moveTo(bx,by);ctx.lineTo(ax,ay);ctx.stroke();
        }
        // A point u along the line is min(from+u, to+1-u) lines from air:
        // the breath comes in from a up to the middle, and from b past it.
        // A round head shows the breath from its first moment.
        ctx.globalAlpha=1;ctx.setLineDash([]);ctx.lineCap="round";ctx.beginPath();
        const middle=Math.min(1,Math.max(0,(line.to+1-line.from)/2));
        const far=Math.min(ahead,reach);
        along(Math.max(0,near-line.from),Math.min(middle,far-line.from));
        along(Math.max(middle,line.to+1-far),Math.min(1,line.to+1-near));
        ctx.stroke();
        ctx.restore();
      }
    }
    // The breath's start: a circle closing in on each liberty, well inside a
    // stone's size and soft at its edge so it never reads as one. It ends as
    // a solid dot the line's width. A liberty both sides need gets a whole
    // circle from each in turn. Groups of one side that share a liberty
    // share its circle: it closes in with the first group's breath and stays
    // a dot until the last has drawn its own in.
    if(moving)for(const {point,color,first,last} of dots.values()){
      const [x,y]=xy(point), held=after(color,first);
      if(held>=last-first+BREATH_GATHER_MS)continue;
      const gather=Math.min(1,held/BREATH_GATHER_MS);
      // It fades in from nothing over the first third, then darkens.
      const rise=Math.min(1,gather*3);
      ctx.globalAlpha=(.4+.5*gather)*rise*rise*(3-2*rise);
      const radius=gap*(.04+.22*(1-gather**2)), core=gap*.04/radius;
      const soft=ctx.createRadialGradient(x,y,0,x,y,radius);
      soft.addColorStop(0,`rgba(${rgb[color]},1)`);
      soft.addColorStop(core,`rgba(${rgb[color]},1)`);
      soft.addColorStop(1,`rgba(${rgb[color]},0)`);
      ctx.fillStyle=core<1?soft:tone[color];ctx.beginPath();
      ctx.arc(x,y,radius,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
    if(moving && frame===null)frame=requestFrame(()=>{frame=null;draw();});
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
  // With 盤の線 on (cut) they fade one after another from the placed stone out, under the cut line.
  // ドパガキモード ("on") also rings out from the placed stone and sends
  // rainbow sparks out of each taken one, more and farther the more were taken.
  function noteCaptures(game,live,burst,cut) {
    const before=lastLive;
    lastLive=live?{board:[...game.board],moves:game.moves.length,alpha:shownAlpha}:null;
    if(!live || !before || before.board.length!==game.board.length || game.moves.length!==before.moves+1 ||
       !requestFrame || stillMotion())return;
    const start=now();
    const taken=[];
    for(let i=0;i<game.board.length;i++){
      if(before.board[i] && !game.board[i] && before.alpha[i])taken.push(i);
      if(burst==="on" && !before.board[i] && game.board[i])waves.push({x:i%SIZE,y:Math.floor(i/SIZE),start});
    }
    // Stones already cut while the move was placed only fade from there.
    const placed=game.moves.at(-1)?.position, whole=taken.filter(i=>before.alpha[i]===1);
    const cutting=cut && whole.length===taken.length && taken.length && Number.isInteger(placed);
    const cutAt=cutting?cutFrom(before.board,placed,taken,start):null;
    for(const i of taken)
      fading.push({position:i,color:before.board[i],from:before.alpha[i],start,delay:cutAt?cutAt(i):0});
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
    fading=fading.filter(f=>time-f.start-f.delay<CAPTURE_FADE_MS);
    for(const f of fading)
      paintStone(theme,f.color,pad+(f.position%SIZE)*gap,pad+Math.floor(f.position/SIZE)*gap,gap*.44,
        f.from*Math.min(1,1-(time-f.start-f.delay)/CAPTURE_FADE_MS));
    if(fading.length && frame===null)frame=requestFrame(()=>{frame=null;draw();});
  }

  // How faint each stone the placed move would take is shown: with the cut
  // running, full until the cut reaches it and then fading to
  // PREVIEW_CAPTURED_ALPHA; otherwise that at once. A new placement starts
  // its own cut and drops the last one's.
  function previewCapture(display,candidate,cut) {
    const placed=candidate?.moves.at(-1)?.position;
    if(previewCut?.board!==candidate?.board){
      cuts=cuts.filter(c=>!c.preview);
      const taken=candidate && cut && requestFrame && !stillMotion() && Number.isInteger(placed) ?
        display.board.flatMap((v,i)=>v && !candidate.board[i]?[i]:[]) : [];
      const start=now();
      previewCut=taken.length?{board:candidate.board,start,delay:cutFrom(display.board,placed,taken,start,true)}:
        candidate?{board:candidate.board}:null;
    }
    if(!previewCut?.delay)return ()=>PREVIEW_CAPTURED_ALPHA;
    const time=now()-previewCut.start;
    return i=>{
      const t=Math.min(1,Math.max(0,(time-previewCut.delay(i))/CAPTURE_FADE_MS));
      if(t<1 && frame===null)frame=requestFrame(()=>{frame=null;draw();});
      return 1-(1-PREVIEW_CAPTURED_ALPHA)*t;
    };
  }

  // The line through the groups a move took, in lines from the stone that
  // filled their last liberty: from there it is cut one stone at a time, and
  // each stone starts fading when the cut reaches its middle.
  function cutFrom(board,placed,taken,start,preview=false) {
    const dead=new Set(taken), depth=new Map([[placed,0]]);
    let front=[placed];
    while(front.length){
      const next=[];
      for(const s of front)for(const n of neighbors(s,SIZE))
        if(dead.has(n) && !depth.has(n)){depth.set(n,depth.get(s)+1);next.push(n);}
      front=next;
    }
    const step=Math.min(CAPTURE_STEP_MS,CAPTURE_SPREAD_MS/Math.max(1,...depth.values()));
    const lines=[];
    for(const s of taken)for(const n of neighbors(s,SIZE))
      if(n===placed || dead.has(n) && board[n]===board[s] && n>s){
        const [a,b]=depth.get(n)<=depth.get(s)?[n,s]:[s,n];
        lines.push({a,b,from:depth.get(a),to:depth.get(b),color:board[s],liberty:n===placed});
      }
    cuts.push({lines,start,step,end:Math.max(...depth.values())+1,preview});
    return i=>depth.get(i)*step;
  }
  // A captured group's line stays solid where the cut has not reached, the
  // stretch to its last liberty flared like any line to a liberty.
  function paintCuts(view,gap,pad) {
    const time=now(), palette=countingPalette(view.palette);
    cuts=cuts.filter(c=>time-c.start<c.end*c.step);
    const width=Math.max(2,gap*.08), flare=gap*.14, edge=1-.44;
    const xy=i=>[pad+(i%SIZE)*gap,pad+Math.floor(i/SIZE)*gap];
    ctx.save();
    ctx.lineCap="round";
    for(const c of cuts){
      const reached=(time-c.start)/c.step;
      for(const line of c.lines){
        const [ax,ay]=xy(line.a),[bx,by]=xy(line.b);
        const along=(u,v)=>{if(v>u){ctx.moveTo(ax+(bx-ax)*u,ay+(by-ay)*u);ctx.lineTo(ax+(bx-ax)*v,ay+(by-ay)*v);}};
        ctx.save();
        ctx.strokeStyle=`rgb(${paletteAt(line.color===BLACK?1:-1,palette).join(",")})`;
        ctx.lineWidth=width;
        if(line.liberty){
          const at=(u,side)=>[ax+(bx-ax)*u+(ay-by)/gap*side,ay+(by-ay)*u+(bx-ax)/gap*side];
          const outline=[[0,width/2],[edge,flare/2],[edge,width/2],[1,width/2],[1,-width/2],[edge,-width/2],[edge,-flare/2],[0,-width/2]];
          ctx.beginPath();
          outline.forEach(([u,side],k)=>ctx[k?"lineTo":"moveTo"](...at(u,side)));
          ctx.closePath();ctx.clip();
          ctx.lineWidth=flare;ctx.lineCap="butt";
        }
        // A point u along the line is min(from+u, to+1-u) lines from the
        // placed stone; what the cut has passed is gone, and the placed
        // stone itself is never drawn over.
        const middle=Math.min(1,Math.max(0,(line.to+1-line.from)/2));
        ctx.beginPath();
        along(Math.max(line.liberty?.44:0,reached-line.from),middle);
        along(middle,Math.min(1,line.to+1-reached));
        ctx.stroke();
        ctx.restore();
      }
    }
    ctx.restore();
    if(cuts.length && frame===null)frame=requestFrame(()=>{frame=null;draw();});
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
    const scoredFinished=countedEnd(game) && !isGomoku(game);
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
    if(!live){fading=[];cuts=[];previewCut=null;sparks=[];pops=[];waves=[];}
    shownAlpha=[];
    // The cut shows with 盤の線 on, whether always or 仮置き時.
    const cut=live && !!view.linkStones && view.linkStones!=="off" && !view.hideStones;
    paintStones(theme,view,display,gap,pad,cut);
    noteCaptures(game,live,view.burst,cut);
    if(fading.length)paintFading(theme,gap,pad);
    if(cuts.length)paintCuts(view,gap,pad);
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
