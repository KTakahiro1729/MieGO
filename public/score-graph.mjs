import {BLACK, whiteCompensation} from "./core.mjs";

// The score graph of a replayed game: Black's estimated lead at every step,
// from the ownership estimate kept for that position. It is an estimate of
// the network without reading, so the graph names no move good or bad; it
// only marks where the estimate swung most against the player who moved.

const num = v => +v.toFixed(1);
const escape = text => String(text).replace(/[&<>"]/g,c=>"&#"+c.charCodeAt(0)+";");

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
 * SVG markup of the graph, built from numbers and the escaped step label, so it
 * is safe to assign as innerHTML. Black's lead is up: the black area grows as Black leads. The vertical scale is symmetric and at least
 * ±minScale points so a close game stays flat. Colours come from CSS classes.
 */
export function scoreGraphSvg(raw, {width=300, height=48, step=0, marks=[], minScale=10, stepLabel=String}={}) {
  const series=raw.map(v=>Number.isFinite(v)?v:null);
  const last=Math.max(1,series.length-1);
  const known=series.filter(v=>v!==null);
  const scale=Math.max(minScale,...known.map(v=>Math.abs(v)));
  const x=s=>num(s/last*width);
  const y=v=>num(height/2-v/scale*(height/2-2));
  const mid=num(height/2);
  // Gaps where no estimate is kept yet break the line instead of bridging it.
  const runs=[];
  series.forEach((v,s)=>{
    if(v===null){runs.push([]);return;}
    if(!runs.length)runs.push([]);
    runs.at(-1).push([x(s),y(v)]);
  });
  const filled=runs.filter(run=>run.length);
  const d=filled.map(run=>run.map(([px,py],i)=>(i?"L":"M")+px+" "+py).join("")).join("");
  // Two tones, as in chess evaluation graphs: black fills from the bottom up
  // to the line and white from the top down to it, so the colour that covers
  // more of the graph is the side ahead. Gaps stay unfilled.
  const black=filled.map(run=>"M"+run[0][0]+" "+height+run.map(([px,py])=>"L"+px+" "+py).join("")+"L"+run.at(-1)[0]+" "+height+"Z").join("");
  const white=filled.map(run=>"M"+run[0][0]+" 0"+run.map(([px,py])=>"L"+px+" "+py).join("")+"L"+run.at(-1)[0]+" 0Z").join("");
  const parts=[];
  if(black)parts.push(`<path class="score-graph-black" d="${black}"/>`,`<path class="score-graph-white" d="${white}"/>`);
  parts.push(`<line class="score-graph-axis" x1="0" y1="${mid}" x2="${width}" y2="${mid}"/>`);
  if(d)parts.push(`<path class="score-graph-line" d="${d}" fill="none"/>`);
  const at=Math.max(0,Math.min(last,Math.trunc(Number(step)||0)));
  for(const s of marks){
    const v=series[s];
    if(!Number.isInteger(s) || v===null || v===undefined)continue;
    parts.push(`<circle class="score-graph-mark${s===at?" is-current":""}" cx="${x(s)}" cy="${y(v)}" r="3.5"/>`);
  }
  // The ends of the step axis, so the graph reads as the game from its start.
  parts.push(`<text class="score-graph-label" x="3" y="11">0</text>`,
    `<text class="score-graph-label" x="${width-3}" y="11" text-anchor="end">${escape(stepLabel(series.length-1))}</text>`);
  const stepX=Math.max(1,Math.min(width-1,x(at))); // Kept whole at either edge.
  parts.push(`<line class="score-graph-step" x1="${stepX}" y1="0" x2="${stepX}" y2="${height}"/>`);
  // A knob like a slider's shows the step line can be dragged. It rides the
  // line where the step is estimated and stays inside the graph's height.
  const r=8, v=series[at];
  const knobY=Math.max(r+1,Math.min(height-r-1,v===null||v===undefined?mid:y(v)));
  parts.push(`<circle class="score-graph-knob" cx="${x(at)}" cy="${num(knobY)}" r="${r}"/>`);
  return `<svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${parts.join("")}</svg>`;
}
