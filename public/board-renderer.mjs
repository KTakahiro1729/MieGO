import {
  BLACK,
  group,
  isFree,
  isGomoku,
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
} from "./territory-view.mjs";
import {boardTheme} from "./board-theme.mjs";
import {stoneForPreview} from "./board-preview.mjs";
import {libertyMarks} from "./liberty-view.mjs";
import {scoringRegions,prisonerFill,prisonersFilled} from "./scoring-regions.mjs";

// Stones taken by a move fade out over this long instead of vanishing.
export const CAPTURE_FADE_MS=200;
// 盤の線 breathes: air flows in from the liberties for BREATH_IN_MS, out
// for BREATH_OUT_MS, then rests for BREATH_REST_MS, about ten breaths a
// minute, which is at the calm end of a person at rest.
export const BREATH_IN_MS=2000, BREATH_OUT_MS=3000, BREATH_REST_MS=1000;
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
    if(view.linkStones==="bridge" && !hidden)paintStoneLinks(theme,proposedBoard||display.board,gap,pad);
    const shown=[];
    for(let i=0;i<display.board.length;i++) {
      const {color:committedColor,captured} = stoneForPreview(display.board, proposedBoard, i);
      // A forbidden point is selectable, but the stone is never committed.
      const color=!boardReview && illegalCandidate?.position===i && display.board[i]===0
        ? game.next : committedColor;
      if(!color || hidden && i!==preview)continue;
      // Dead stones are off the board once the count is final, or filled under Japanese rules.
      if(!boardReview && (game.status==="finished" && !game.result?.endsWith("+R") ||
         prisonersFilled(game)) && game.dead?.includes(i))continue;
      shown.push({i,color,alpha:captured ? 0.4 : i===preview ? 0.68 : 1});
    }
    // 一つの形: the solid stones are drawn group by group; the stone being
    // placed and the ones it would take stay single, see-through stones.
    const shaped=view.linkStones==="breathing" || view.linkStones==="square";
    const fused=view.linkStones==="fused" || shaped ? Array(display.board.length).fill(0) : null;
    // 息の形, 四角 and 盤の線 read the stones as shown, the one being placed included.
    const around=Array(display.board.length).fill(0);
    for(const {i,color,alpha} of shown)if(alpha!==.4)around[i]=color;
    if(fused){
      for(const {i,color,alpha} of shown)if(alpha===1)fused[i]=color;
      paintFusedStones(theme,fused,gap,pad,shaped?around:null,view.linkStones==="square");
    }
    for(const {i,color,alpha} of shown) {
      const x=pad+(i%SIZE)*gap;
      const y=pad+Math.floor(i/SIZE)*gap;
      const r=gap*.44;
      shownAlpha[i]=alpha;
      if(!fused?.[i])paintStone(theme,color,x,y,r,alpha);

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
    if(view.linkStones==="lines" && !hidden){
      const moving=(boardReview || game.status==="playing") && !isGomoku(game) && !isFree(game) &&
        requestFrame && !stillMotion();
      paintBoardLines(view,around,gap,pad,moving);
    }
  }

  // 盤の線: a still dashed line runs through each group, along the board's
  // lines from stone to stone and out to a dot on every empty point next to
  // it, so a group shows what holds it together and the points it needs.
  // While playing, the group breathes: a solid line fills the dashes from
  // the liberties inward, the whole group at once, and drains back out. A
  // group in atari draws its breath only as far as the edge of its stone.
  // Each side keeps its own colour on the colour map whatever its state.
  function paintBoardLines(view,board,gap,pad,moving) {
    const palette=countingPalette(view.palette);
    const tone={[BLACK]:`rgb(${paletteAt(1,palette).join(",")})`,[WHITE]:`rgb(${paletteAt(-1,palette).join(",")})`};
    const r=gap*.44, dot=gap*.13, width=Math.max(2,gap*.08), dash=gap*.09;
    // How full of air the groups are: eased in, eased out, then a rest.
    let air=0;
    if(moving){
      const t=now()%(BREATH_IN_MS+BREATH_OUT_MS+BREATH_REST_MS), ease=u=>(1-Math.cos(Math.PI*u))/2;
      air=t<BREATH_IN_MS?ease(t/BREATH_IN_MS):t<BREATH_IN_MS+BREATH_OUT_MS?1-ease((t-BREATH_IN_MS)/BREATH_OUT_MS):0;
    }
    const xy=i=>[pad+(i%SIZE)*gap,pad+Math.floor(i/SIZE)*gap];
    const dots=new Map(), seen=new Set();
    ctx.save();
    ctx.lineWidth=width;ctx.lineCap="butt";
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
      // Each line runs from a (a liberty at depth 0, or a stone) to stone b;
      // the air goes half a line past the deepest stone, across any line
      // between two stones at the same depth.
      const lines=[];
      for(const s of g.stones)for(const n of neighbors(s,SIZE)){
        if(!board[n]){
          lines.push({a:n,b:s,from:0,to:depth.get(s),start:dot/gap});
          if(!dots.has(n))dots.set(n,[]);
          dots.get(n).push({toward:s,color});
        }else if(g.stones.has(n) && n>s)lines.push({a:s,b:n,from:depth.get(s),to:depth.get(n),start:0});
      }
      const deepest=Math.max(...depth.values());
      const reach=g.liberties.size===1?air*(1-.44):air*(deepest+.5);
      for(const line of lines){
        const [ax,ay]=xy(line.a),[bx,by]=xy(line.b);
        const along=(u,v)=>{ctx.moveTo(ax+(bx-ax)*u,ay+(by-ay)*u);ctx.lineTo(ax+(bx-ax)*v,ay+(by-ay)*v);};
        ctx.strokeStyle=tone[color];
        // The dashes start at the stone so they line up through the group.
        ctx.globalAlpha=.75;ctx.setLineDash([dash,dash]);ctx.lineDashOffset=0;
        ctx.beginPath();along(1,line.start);ctx.stroke();
        // The air: every point of the line no further in than the reach.
        ctx.globalAlpha=1;ctx.setLineDash([]);ctx.beginPath();
        const near=Math.min(1,reach-line.from), far=Math.max(0,1-(reach-line.to));
        if(near>line.start)along(line.start,near);
        if(far<1)along(Math.max(line.start,far),1);
        ctx.stroke();
      }
    }
    // A dot on each liberty, split between the sides where both need it.
    for(const [point,needs] of dots){
      const [x,y]=xy(point);
      if(needs.every(need=>need.color===needs[0].color)){
        ctx.fillStyle=tone[needs[0].color];ctx.beginPath();ctx.arc(x,y,dot,0,Math.PI*2);ctx.fill();
        continue;
      }
      for(const need of needs){
        const [sx,sy]=xy(need.toward), angle=Math.atan2(sy-y,sx-x);
        ctx.fillStyle=tone[need.color];ctx.beginPath();ctx.moveTo(x,y);
        ctx.arc(x,y,dot,angle-Math.PI/2,angle+Math.PI/2);ctx.closePath();ctx.fill();
      }
    }
    ctx.restore();
    if(moving && frame===null)frame=requestFrame(()=>{frame=null;draw();});
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

  // 一つの形: every group is one shape, its stones' circles joined by bars
  // as wide as a stone, with one rim around the whole. Four stones in a
  // square also fill the gap in their middle. Each stone keeps a soft
  // highlight, so a group still shows how many stones it has.
  // 息の形 (`around` is the whole position): each stone also bulges toward
  // the empty points next to it and is pressed flat where an opponent stone
  // or the board's edge closes it in, so a group in atari looks squeezed.
  // 四角: a square stone whose sides join its own colour, bulge toward an
  // empty point and dent in where an opponent stone touches it.
  function paintFusedStones(theme,board,gap,pad,around=null,square=false) {
    const r=gap*(around?.4:.44), rim=.75;
    function squareStone(i,x,y,w){
      const sides=[[0,-1],[1,0],[0,1],[-1,0]];
      const corners=[[-1,-1],[1,-1],[1,1],[-1,1]];
      ctx.moveTo(x-w,y-w);
      sides.forEach(([dx,dy],k)=>{
        const nx=i%SIZE+dx, ny=Math.floor(i/SIZE)+dy;
        const next=nx>=0 && ny>=0 && nx<SIZE && ny<SIZE ? around[ny*SIZE+nx] : null;
        const push=next===0?gap*.24:next===null||next===board[i]?0:-gap*.16;
        const [ex,ey]=corners[(k+1)%4];
        ctx.quadraticCurveTo(x+dx*(w+push),y+dy*(w+push),x+ex*w,y+ey*w);
      });
      ctx.closePath();
    }
    const xy=i=>[pad+(i%SIZE)*gap,pad+Math.floor(i/SIZE)*gap];
    const same=(i,j,color)=>j<board.length && board[j]===color;
    // The edge of a stone at angle `a`: round, bulged or flat by what lies that way.
    function edge(i,a,w){
      const k=((Math.round(a/(Math.PI/2))%4)+4)%4, phi=a-Math.round(a/(Math.PI/2))*Math.PI/2;
      const x=i%SIZE+[1,0,-1,0][k], y=Math.floor(i/SIZE)+[0,1,0,-1][k];
      const next=x>=0 && y>=0 && x<SIZE && y<SIZE ? around[y*SIZE+x] : null;
      if(next===0)return w+gap*.12*Math.max(0,Math.cos(2*phi))**2;
      if(next!==board[i])return Math.min(w,(w-r+gap*.31)/Math.cos(phi));
      return w;
    }
    // A bar's side is pressed flat when either stone it joins is closed in on that side.
    function side(i,j,dx,dy,w){
      if(!around)return w;
      const open=k=>{
        const x=k%SIZE+dx, y=Math.floor(k/SIZE)+dy;
        return x>=0 && y>=0 && x<SIZE && y<SIZE && (around[y*SIZE+x]===0 || around[y*SIZE+x]===board[k]);
      };
      return open(i) && open(j) ? w : w-r+gap*.31;
    }
    function bar(x,y,horizontal,i,j,w){
      const [a,b]=horizontal?[side(i,j,0,-1,w),side(i,j,0,1,w)]:[side(i,j,-1,0,w),side(i,j,1,0,w)];
      if(horizontal){ctx.moveTo(x,y-a);ctx.lineTo(x+gap,y-a);ctx.lineTo(x+gap,y+b);ctx.lineTo(x,y+b);}
      else{ctx.moveTo(x-a,y);ctx.lineTo(x+b,y);ctx.lineTo(x+b,y+gap);ctx.lineTo(x-a,y+gap);}
      ctx.closePath();
    }
    function outline(color,grow){
      const w=r+grow;
      ctx.beginPath();
      for(let i=0;i<board.length;i++){
        if(board[i]!==color)continue;
        const [x,y]=xy(i), right=i%SIZE<SIZE-1 && same(i,i+1,color), down=same(i,i+SIZE,color);
        if(square)squareStone(i,x,y,w);
        else if(around){
          for(let step=0;step<=72;step++){
            const a=step*Math.PI/36, e=edge(i,a,w);
            if(step)ctx.lineTo(x+e*Math.cos(a),y+e*Math.sin(a));else ctx.moveTo(x+e,y);
          }
          ctx.closePath();
        }else{ctx.moveTo(x+w,y);ctx.arc(x,y,w,0,Math.PI*2);}
        if(right)around && !square?bar(x,y,true,i,i+1,w):ctx.rect(x,y-w,gap,2*w);
        if(down)around && !square?bar(x,y,false,i,i+SIZE,w):ctx.rect(x-w,y,2*w,gap);
        if(right && down && same(i,i+SIZE+1,color))ctx.rect(x,y,gap,gap);
      }
    }
    // Shaded white stones are lighter in the middle than at the edge; the
    // body leans to the edge's tone, so each stone's highlight still shows.
    const mid=(a,b)=>/^#[0-9a-f]{6}$/i.test(a+b.slice(1))?"#"+[1,3,5].map(k=>
      Math.round(parseInt(a.slice(k,k+2),16)*.4+parseInt(b.slice(k,k+2),16)*.6).toString(16).padStart(2,"0")).join(""):a;
    const clear=c=>/^#[0-9a-f]{6}$/i.test(c)?c+"00":null;
    for(const [color,look] of [[BLACK,theme.stones.black],[WHITE,theme.stones.white]]){
      if(!board.includes(color))continue;
      ctx.save();
      outline(color,rim);ctx.fillStyle=look.rim;ctx.fill();
      outline(color,-rim);
      ctx.fillStyle=theme.flatStones?look.outer:color===BLACK?look.outer:mid(look.inner,look.outer);
      ctx.fill();
      if(!theme.flatStones && clear(look.inner) && ctx.createRadialGradient){
        for(let i=0;i<board.length;i++){
          if(board[i]!==color)continue;
          const [x,y]=xy(i), hx=x-r*.2, hy=y-r*.2;
          const grad=ctx.createRadialGradient(hx,hy,2,hx,hy,r*.75);
          grad.addColorStop(0,look.inner);grad.addColorStop(1,clear(look.inner));
          ctx.fillStyle=grad;ctx.beginPath();ctx.arc(hx,hy,r*.75,0,Math.PI*2);ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  // 呼吸点の表示 on the board being played or replayed: the provisional
  // board while a stone is placed, otherwise the shown position.
  const ATARI_MARK="#d95a4e", LOW_MARK="#eea23a";
  function shownLiberties(view,display) {
    const {game,boardReview,candidate}=view;
    if(!view.liberties || view.liberties==="off" || isGomoku(game) || isFree(game))return [];
    if(!boardReview && game.status!=="playing" || view.hideStones)return [];
    const board=boardReview?boardReview.preview?.board||display.board:candidate?.board||game.board;
    const placed=boardReview?boardReview.preview?.board && boardReview.previewPosition:
      candidate?.moves.at(-1)?.position;
    return libertyMarks(board,view.liberties,placed);
  }
  // 危ないときだけ: a band around each group down to two liberties (amber)
  // or one (red), painted under the stones so it shows only at the edge.
  function paintDangerBands(marks,gap,pad) {
    const r=gap*.44+Math.max(3,gap*.09);
    for(const mark of marks){
      if(mark.kind!=="danger")continue;
      const stones=new Set(mark.stones);
      ctx.save();
      ctx.fillStyle=mark.count===1?ATARI_MARK:LOW_MARK;
      ctx.beginPath();
      for(const i of stones){
        const x=pad+(i%SIZE)*gap,y=pad+Math.floor(i/SIZE)*gap;
        ctx.moveTo(x+r,y);ctx.arc(x,y,r,0,Math.PI*2);
        if(i%SIZE<SIZE-1 && stones.has(i+1))ctx.rect(x,y-r,gap,2*r);
        if(stones.has(i+SIZE))ctx.rect(x-r,y,2*r,gap);
      }
      ctx.fill();
      ctx.restore();
    }
  }
  function paintLiberties(theme,marks,gap,pad) {
    const tone={[BLACK]:theme.stones.black.outer,[WHITE]:theme.stones.white.inner};
    const xy=i=>[pad+(i%SIZE)*gap,pad+Math.floor(i/SIZE)*gap];
    for(const mark of marks){
      if(mark.kind==="danger")continue;
      const [x,y]=xy(mark.position);
      ctx.save();
      if(mark.kind==="tube"){
        // The placed stone's group breathes through this point: a short
        // tube from each of its stones that touch it, and a dot.
        const color=mark.atari?ATARI_MARK:tone[mark.color];
        ctx.strokeStyle=color;ctx.lineWidth=Math.max(2,gap*.1);ctx.lineCap="round";
        ctx.beginPath();
        for(const from of mark.from){
          const [sx,sy]=xy(from);
          ctx.moveTo(sx+(x-sx)*.42,sy+(y-sy)*.42);ctx.lineTo(x,y);
        }
        ctx.stroke();
        ctx.beginPath();ctx.arc(x,y,gap*.13,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
        ctx.strokeStyle=mark.color===WHITE && !mark.atari?tone[BLACK]:"rgba(255,255,255,.75)";
        ctx.lineWidth=Math.max(1,gap*.025);ctx.stroke();
      }else if(mark.kind==="dot"){
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
    const liberties=shownLiberties(view,display);
    paintDangerBands(liberties,gap,pad);
    paintStones(theme,view,display,gap,pad);
    noteCaptures(game,live,view.burst);
    if(fading.length)paintFading(theme,gap,pad);
    paintLiberties(theme,liberties,gap,pad);
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
