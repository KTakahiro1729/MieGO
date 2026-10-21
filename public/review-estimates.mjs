// While a game is replayed: KataGo's estimates of its other positions, asked in
// the background, and the 形勢グラフ drawn from them.
import { isFree, isGomoku } from "./core.mjs";
import { prefetchOrder, replayLine } from "./ownership-prefetch.mjs";
import { leadSeries, scoreGraphSvg, stepAt, swingSteps } from "./score-graph.mjs";
import { activeReviewSnapshot } from "./review-variation.mjs";
import { TEXT } from "./texts.mjs";

/**
 * KataGo estimates the replayed line's positions, nearest to the one on screen
 * first, whenever `canAsk()` says the worker is idle. `owner()` names whose
 * estimates the line holds; `onKept(owner, board, values)` keeps each answer.
 */
export function createReviewPrefetch({post, nextId, canAsk, recall, owner, onKept}) {
  let prefetch=null;
  function plan(line, step) {
    if(prefetch?.line!==line){
      let states;
      try{states=replayLine(line);}catch{prefetch=null;return;}
      prefetch={line,states,queue:[],inflight:null,...owner()};
    }
    prefetch.queue=prefetchOrder(prefetch.states.length-1,step)
      .filter(step=>step!==prefetch.inflight?.step);
    pump();
  }
  function pump() {
    if(!prefetch || prefetch.inflight || !canAsk())return;
    while(prefetch.queue.length){
      const step=prefetch.queue.shift(),state=prefetch.states[step];
      if(!state || recall(prefetch.gameId,state.board))continue;
      const id=nextId();
      post({id,state,board:state.board});
      prefetch.inflight={id,step};
      return;
    }
  }
  const stop=()=>{prefetch=null;};
  /** A newer request supersedes a background estimate, which is then asked again. */
  function giveWay() {
    if(prefetch?.inflight){prefetch.queue.unshift(prefetch.inflight.step);prefetch.inflight=null;}
  }
  /** Takes the worker's answer to a background estimate; false for any other answer. */
  function receive(result, validFor) {
    if(!prefetch?.inflight || result.id!==prefetch.inflight.id)return false;
    const state=prefetch.states[prefetch.inflight.step];
    prefetch.inflight=null;
    if(validFor(state))onKept(prefetch,state.board,result.ownership);
    else prefetch=null; // A failing estimate is not retried in the background.
    return true;
  }
  return {giveWay,plan,pump,receive,stop};
}

/**
 * 形勢グラフ: Black's estimated lead at every step of the replayed line, drawn
 * where the step slider was. It fills in as KataGo estimates the positions.
 */
export function createScoreGraph({$, getReview, getGame, isWatching, recall, gameId, setStep}) {
  let scoreGraph=null;
  // No graph while stepping back through a game still being played: it would
  // tell the player who is ahead mid-game. A watched game has no player to tell.
  const shown=()=>{
    const review=getReview();
    return !!review && !isGomoku(review.display) && !isFree(review.display) &&
      !(review.source==="live" && getGame().status!=="finished" && !isWatching());
  };
  function render() {
    const box=$("reviewGraph"),visible=shown(),review=getReview();
    box.classList.toggle("no-graph",!visible);
    if(!visible){$("reviewGraphPlot").innerHTML="";scoreGraph=null;return;}
    const line=activeReviewSnapshot(review,getGame());
    if(scoreGraph?.line!==line){
      let states=[];
      try{states=replayLine(line);}catch{}
      scoreGraph={line,states,marks:[]};
    }
    const id=gameId();
    // A line that ended early (a resignation) still spans every step.
    const series=Array(line.moves.length+1).fill(null);
    leadSeries(scoreGraph.states,state=>recall(id,state.board))
      .forEach((lead,step)=>{if(step<series.length)series[step]=lead;});
    scoreGraph.marks=swingSteps(series,line.moves,{minSwing:Math.max(3,line.board.length/27)});
    const width=Math.round(box.clientWidth),height=Math.round(box.clientHeight);
    // Not laid out yet (the tools are still hidden): drawing at 1x1 would blow
    // the marks up to the whole bar. The resize observer draws it once sized.
    if(width<=0 || height<=0){$("reviewGraphPlot").innerHTML="";return;}
    $("reviewGraphPlot").innerHTML=scoreGraphSvg(series,{width,height,step:review.step,marks:scoreGraph.marks,stepLabel:()=>TEXT.review.graphEnd(line.moves.filter(move=>move.position!=="resign").length)});
  }
  // A tap near a marked turning point lands on it; otherwise on the nearest step.
  function pick(event) {
    const review=getReview();
    if(!shown() || review.preview)return;
    const rect=$("reviewGraph").getBoundingClientRect();
    const count=activeReviewSnapshot(review,getGame()).moves.length;
    const x=event.clientX-rect.left;
    const near=(scoreGraph?.marks||[]).find(step=>count && Math.abs(step/count*rect.width-x)<=10);
    const step=near ?? stepAt(x,rect.width,count);
    if(step!==review.step)setStep(step);
  }
  return {pick,render,shown};
}
