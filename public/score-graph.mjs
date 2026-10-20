import {BLACK, whiteCompensation} from "./core.mjs";

// The score graph of a replayed game: Black's estimated lead at every step,
// from the ownership estimate kept for that position. It is an estimate of
// the network without reading, so the graph names no move good or bad; it
// only marks where the estimate swung most against the player who moved.

const num = v => +v.toFixed(1);

/** Black's lead (points, komi included) from an ownership map, or null. */
export function leadFromOwnership(state, ownership) {
  if(!Array.isArray(ownership) || ownership.length!==state.board.length)return null;
  let black=0, white=whiteCompensation(state);
  for(const raw of ownership){
    const v=Number(raw);
    if(!Number.isFinite(v))return null;
    black+=(1+v)/2;
    white+=(1-v)/2;
  }
  return black-white;
}

/** One lead per step (step 0 is the starting board); null where no estimate is kept yet. */
export function leadSeries(states, recall) {
  return states.map(state=>leadFromOwnership(state,recall(state)));
}

/**
 * The steps whose move cost its player the most, at most `count`, in move
 * order. Step s is the s-th move; a swing smaller than minSwing points is
 * not a turning point. Passes count like any move.
 */
export function swingSteps(series, moves, {count=3, minSwing=3}={}) {
  const swings=[];
  for(let step=1;step<series.length;step++){
    const before=series[step-1], after=series[step];
    if(before===null || after===null)continue;
    const sign=moves[step-1]?.color===BLACK ? 1 : -1;
    const loss=(before-after)*sign;
    if(loss>=minSwing)swings.push({step,loss});
  }
  return swings.sort((a,b)=>b.loss-a.loss || a.step-b.step).slice(0,count)
    .map(s=>s.step).sort((a,b)=>a-b);
}

/** The step under x on a graph `width` wide showing steps 0..last. */
export function stepAt(x, width, last) {
  if(!(width>0) || !(last>0))return 0;
  return Math.max(0,Math.min(last,Math.round(Number(x)/width*last)));
}

/**
 * SVG markup of the graph, built only from numbers, so it is safe to assign as
 * innerHTML. Black's lead is up. The vertical scale is symmetric and at least
 * ±minScale points so a close game stays flat. Colours come from CSS classes.
 */
export function scoreGraphSvg(raw, {width=300, height=48, step=0, marks=[], minScale=10}={}) {
  const series=raw.map(v=>Number.isFinite(v)?v:null);
  const last=Math.max(1,series.length-1);
  const known=series.filter(v=>v!==null);
  const scale=Math.max(minScale,...known.map(v=>Math.abs(v)));
  const x=s=>num(s/last*width);
  const y=v=>num(height/2-v/scale*(height/2-2));
  const parts=[`<line class="score-graph-axis" x1="0" y1="${num(height/2)}" x2="${width}" y2="${num(height/2)}"/>`];
  // Gaps where no estimate is kept yet break the line instead of bridging it.
  let d="", open=false;
  series.forEach((v,s)=>{
    if(v===null){open=false;return;}
    d+=(open?"L":"M")+x(s)+" "+y(v);
    open=true;
  });
  if(d)parts.push(`<path class="score-graph-line" d="${d}" fill="none"/>`);
  for(const s of marks){
    const v=series[s];
    if(!Number.isInteger(s) || v===null || v===undefined)continue;
    parts.push(`<circle class="score-graph-mark" cx="${x(s)}" cy="${y(v)}" r="3.5"/>`);
  }
  const at=Math.max(0,Math.min(last,Math.trunc(Number(step)||0)));
  parts.push(`<line class="score-graph-step" x1="${x(at)}" y1="0" x2="${x(at)}" y2="${height}"/>`);
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${parts.join("")}</svg>`;
}
