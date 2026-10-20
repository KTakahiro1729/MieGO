import {createBoardRenderer} from "../../public/board-renderer.mjs";

// A board renderer over a 2D context that records what it paints: each
// fillRect, rect, arc, lineTo and drawImage with the alpha at that moment, the text of each
// fillText, and the last pixels put into the ownership overlay.
export function recordingBoard(getView,{width=500,...options}={}) {
  const calls=[],labels=[],stack=[];
  let alpha=1;
  const ctx={
    get globalAlpha(){return alpha;},
    set globalAlpha(value){alpha=value;},
    save(){stack.push(alpha);},restore(){alpha=stack.pop();},
    clearRect(){},beginPath(){},closePath(){},moveTo(){},
    lineTo(...args){calls.push({kind:"line",args,alpha});},
    quadraticCurveTo(...args){calls.push({kind:"curve",args,alpha});},stroke(){},setLineDash(){},fill(){},
    fillRect(...args){calls.push({kind:"rect",args,alpha});},
    arc(...args){calls.push({kind:"arc",args,alpha});},
    rect(...args){calls.push({kind:"path-rect",args,alpha});},
    fillText(text){labels.push(text);},
    createRadialGradient(){return {addColorStop(){}};},
    drawImage(...args){calls.push({kind:"image",args,smoothing:this.imageSmoothingEnabled});}
  };
  const overlay={data:null,createImageData(w,h){return {data:new Uint8ClampedArray(w*h*4)};},
    putImageData(image){this.data=image.data.slice();}};
  const renderer=createBoardRenderer({
    canvas:{width,getContext:()=>ctx},
    getView,createOverlayCanvas:()=>({getContext:()=>overlay}),...options
  });
  return {draw:renderer.draw,calls,labels,overlay};
}

// What app.mjs passes for a plain game with nothing selected.
export const baseView=game=>({game,boardReview:null,candidate:null,lastPosition:null,
  displayedOwnership:null,palette:"mono",opacity:.55,humanTurn:false});
