import {SIZE, BLACK} from "./core.mjs";
import {ownershipPixel} from "./territory-view.mjs";
import {illegalMoveReasons, drawIllegalMoveMarker} from "./illegal-moves.mjs";
import {stoneForPreview} from "./board-preview.mjs";

const STAR_POINTS = [[2,2],[6,2],[4,4],[2,6],[6,6]];

/**
 * Draws the current board without modifying the match. Each draw reads one
 * consistent view from getView, including its provisional/replayed position.
 * The optional canvas factory keeps this module testable without a DOM.
 */
export function createBoardRenderer({canvas,getView,createOverlayCanvas=()=>document.createElement("canvas")}) {
  const ctx = canvas.getContext("2d");
  const overlayCanvas = createOverlayCanvas();
  overlayCanvas.width = SIZE;
  overlayCanvas.height = SIZE;
  const overlayContext = overlayCanvas.getContext("2d");

  // The cache is private to this renderer and the immutable committed game.
  let illegalCacheGame = null;
  let illegalCache = new Map();

  function paintGrid(d, gap, pad) {
    ctx.clearRect(0,0,d,d);
    ctx.fillStyle = "#e5c58c";
    ctx.fillRect(0,0,d,d);
    ctx.strokeStyle = "#685537";
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
    const shown = boardReview?.display||game;
    const values = boardReview ? boardReview.ownership : displayedOwnership;
    if(!shown.assisted || !values)return;

    const image = overlayContext.createImageData(SIZE,SIZE);
    for(let i=0;i<SIZE*SIZE;i++) {
      const [r,g,b,a] = ownershipPixel(values[i],palette,opacity);
      const p = i*4;
      image.data[p]=r;
      image.data[p+1]=g;
      image.data[p+2]=b;
      image.data[p+3]=a;
    }
    overlayContext.putImageData(image,0,0);
    ctx.save();
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";
    ctx.drawImage(overlayCanvas,pad-gap/2,pad-gap/2,gap*SIZE,gap*SIZE);
    ctx.restore();
  }

  function paintIllegalMarkers({game,boardReview,humanTurn}, gap, pad) {
    if(!boardReview && game.status==="playing" && humanTurn) {
      if(illegalCacheGame!==game) {
        illegalCacheGame=game;
        illegalCache=illegalMoveReasons(game);
      }
      for(const [position,reason] of illegalCache) {
        const x=pad+(position%SIZE)*gap;
        const y=pad+Math.floor(position/SIZE)*gap;
        drawIllegalMoveMarker(ctx,x,y,gap,reason);
      }
    }
  }

  function paintStarPoints(gap,pad) {
    for(const [x,y] of STAR_POINTS) {
      ctx.beginPath();
      ctx.arc(pad+x*gap,pad+y*gap,4,0,Math.PI*2);
      ctx.fillStyle="#725b39";
      ctx.fill();
    }
  }

  function paintStone(color,x,y,r,alpha) {
    ctx.save();
    ctx.globalAlpha=alpha;
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2);
    const grad=ctx.createRadialGradient(x-r*.3,y-r*.3,2,x,y,r*1.2);
    if(color===BLACK) {
      grad.addColorStop(0,"#555b5a");
      grad.addColorStop(1,"#101718");
    } else {
      grad.addColorStop(0,"#fff");
      grad.addColorStop(1,"#b8b8b1");
    }
    ctx.fillStyle=grad;
    ctx.fill();
    ctx.strokeStyle=color===BLACK?"#1a2626":"#a1a29c";
    ctx.lineWidth=1.5;
    ctx.stroke();
    ctx.restore();
  }

  function paintStones(view, display, gap, pad) {
    const {game,boardReview,candidate} = view;
    const proposedBoard = boardReview ? null : candidate?.board;
    const preview = boardReview ? null : candidate?.moves.at(-1)?.position;
    for(let i=0;i<display.board.length;i++) {
      const {color,captured} = stoneForPreview(display.board, proposedBoard, i);
      if(!color)continue;
      const x=pad+(i%SIZE)*gap;
      const y=pad+Math.floor(i/SIZE)*gap;
      const r=gap*.44;
      paintStone(color,x,y,r,captured?.4:i===preview?.68:1);

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

  function paintLastMove(view,display,gap,pad) {
    const {game,boardReview,candidate,lastPosition} = view;
    const marker=boardReview?display.moves.at(-1)?.position:lastPosition;
    if(Number.isInteger(marker) && (boardReview||(!candidate && game.status==="playing"))) {
      const x=pad+(marker%SIZE)*gap;
      const y=pad+Math.floor(marker/SIZE)*gap;
      ctx.fillStyle="#d0b25c";
      ctx.fillRect(x-4,y-4,8,8);
    }
  }

  function draw() {
    const view=getView();
    const {game,boardReview}=view;
    const display=boardReview?.display||game;
    const d=canvas.width, gap=d/(SIZE+1), pad=gap;
    paintGrid(d,gap,pad);
    paintOwnership(view,gap,pad);
    paintIllegalMarkers(view,gap,pad);
    paintStarPoints(gap,pad);
    paintStones(view,display,gap,pad);
    paintLastMove(view,display,gap,pad);
  }
  return {draw};
}
