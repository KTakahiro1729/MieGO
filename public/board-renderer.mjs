import {SIZE, BLACK} from "./core.mjs";
import {ownershipPixel} from "./territory-view.mjs";
import {illegalMoveReasons,drawIllegalMoveMarker} from "./illegal-moves.mjs";
import {stoneForPreview} from "./board-preview.mjs";

// Rendering-only component. getView() supplies the latest state; this module never commits moves.
// createOverlayCanvas is injectable for deterministic canvas tests.
export function createBoardRenderer({canvas,getView,createOverlayCanvas=()=>document.createElement("canvas")}) {
  const ctx=canvas.getContext("2d");
  const overlayCanvas=createOverlayCanvas();
  overlayCanvas.width=SIZE; overlayCanvas.height=SIZE;
  const overlayContext=overlayCanvas.getContext("2d");
  function paintOwnership(d, gap, pad, {game,boardReview,displayedOwnership,palette,opacity}) {
    const shown=boardReview?.display||game;
    const values=boardReview?boardReview.ownership:displayedOwnership;
    if (!shown.assisted || !values) return;
    const data = overlayContext.createImageData(SIZE,SIZE);
    for (let i=0;i<SIZE*SIZE;i++) {
      const [r,g,b,a]=ownershipPixel(values[i],palette,opacity);
      const p=i*4;
      data.data[p]=r; data.data[p+1]=g; data.data[p+2]=b; data.data[p+3]=a;
    }
    overlayContext.putImageData(data,0,0);
    ctx.save();
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";
    ctx.drawImage(overlayCanvas,pad-gap/2,pad-gap/2,gap*SIZE,gap*SIZE);
    ctx.restore();
  }
    let illegalCacheGame=null,illegalCache=new Map();
  function draw() {
    const {game,boardReview,candidate,lastPosition,displayedOwnership,palette,opacity,humanTurn}=getView();
    const display=boardReview?.display||game;
    const d = canvas.width, gap = d / (SIZE + 1), pad = gap, b = display.board;
    const proposedBoard = boardReview ? null : candidate?.board;
    ctx.clearRect(0,0,d,d); ctx.fillStyle="#e5c58c";ctx.fillRect(0,0,d,d);
    ctx.strokeStyle="#685537";ctx.lineWidth=2;
    for(let i=0;i<SIZE;i++){const p=pad+i*gap;ctx.beginPath();ctx.moveTo(pad,p);ctx.lineTo(d-pad,p);ctx.moveTo(p,pad);ctx.lineTo(p,d-pad);ctx.stroke();}
    paintOwnership(d,gap,pad,{game,boardReview,displayedOwnership,palette,opacity});
    if(!boardReview && game.status==="playing" && humanTurn) {
      // This state is immutable; cache legal checks during heatmap animation.
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
    for(const [x,y] of [[2,2],[6,2],[4,4],[2,6],[6,6]]){
      ctx.beginPath();ctx.arc(pad+x*gap,pad+y*gap,4,0,Math.PI*2);ctx.fillStyle="#725b39";ctx.fill();
    }
    const preview = boardReview?null:candidate?.moves.at(-1)?.position;
    for(let i=0;i<b.length;i++){
      const {color,captured} = stoneForPreview(b, proposedBoard, i);
      if(!color)continue;
      const x=pad+(i%SIZE)*gap,y=pad+Math.floor(i/SIZE)*gap;
      const r=gap*.44;ctx.save();
      if (captured) ctx.globalAlpha=.4;
      else if (i===preview) ctx.globalAlpha=.68;
      ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);
      const grad=ctx.createRadialGradient(x-r*.3,y-r*.3,2,x,y,r*1.2);
      if(color===BLACK){grad.addColorStop(0,"#555b5a");grad.addColorStop(1,"#101718");}
      else{grad.addColorStop(0,"#fff");grad.addColorStop(1,"#b8b8b1");}
      ctx.fillStyle=grad;ctx.fill();ctx.strokeStyle=color===BLACK?"#1a2626":"#a1a29c";ctx.lineWidth=1.5;ctx.stroke();
      ctx.restore();
      if (i===preview) {
        ctx.save();ctx.strokeStyle="#f5d58b";ctx.lineWidth=3;ctx.setLineDash([7,5]);
        ctx.beginPath();ctx.arc(x,y,r+4,0,Math.PI*2);ctx.stroke();ctx.restore();
      }
      if(!boardReview && game.status==="scoring"&&game.dead.includes(i)){ctx.strokeStyle="#d95a4e";ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(x-r*.45,y-r*.45);ctx.lineTo(x+r*.45,y+r*.45);ctx.moveTo(x+r*.45,y-r*.45);ctx.lineTo(x-r*.45,y+r*.45);ctx.stroke();}
    }
    const marker=boardReview?display.moves.at(-1)?.position:lastPosition;
    if(Number.isInteger(marker) && (boardReview||(!candidate && game.status==="playing"))){
      const x=pad+(marker%SIZE)*gap,y=pad+Math.floor(marker/SIZE)*gap;
      ctx.fillStyle="#d0b25c";ctx.fillRect(x-4,y-4,8,8);
    }
  }
    return {draw};
}
