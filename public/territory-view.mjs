import { groups, neighbors, sizeOf } from "./core.mjs";

// Values are ownership tendencies (-1 white, +1 black), not win probabilities.
// A neutral ownership value (0) is fully transparent: the board is visible.
//
// Colour: each side has a settled colour and a leaning colour. A point is in
// its side's leaning colour up to SETTLED and in the settled colour beyond,
// with a soft blend between. The colours come from a preset or from the
// player (the "custom" map); they are the same on every board look.
//
// Opacity: one curve for both sides, so the same ownership covers the board
// (and its grid lines) by the same amount whichever side it favours. Its
// shape is V (linear in |v|) or U (|v|^2: faint while open, strong when
// decided), and its maximum is the "色の濃さ" slider.
const colours = (whiteSettled,whiteLeaning,blackLeaning,blackSettled) => Object.freeze({
  white:Object.freeze({rgb:Object.freeze(whiteSettled),weak:Object.freeze(whiteLeaning)}),
  black:Object.freeze({rgb:Object.freeze(blackSettled),weak:Object.freeze(blackLeaning)})
});
export const PALETTES = Object.freeze({
  // The stones' own colours, as KaTrain, Lizzie and OGS show ownership.
  mono: colours([246,249,255],[246,249,255],[22,26,34],[22,26,34]),
  // After ColorBrewer PRGn, re-lit for one set of colours on every board:
  // the two sides' steps keep about the same distance from wood, light and
  // dark boards alike, and each leaning colour is lighter than its settled one.
  greenPurple: colours([0,179,115],[116,202,151],[255,189,244],[202,105,200])
});
// The player's own colours; edited in the settings and kept in this module so
// every drawing (board, legend, shared image) reads the same ones.
export const PALETTE_CUSTOM = "custom";
export const COLOUR_KEYS = Object.freeze(["whiteSettled","whiteLeaning","blackLeaning","blackSettled"]);
// Until the player picks, the custom map starts from the colour-blind-safe
// blue-orange pair: White warm and light, Black cool and dark, like the stones.
let custom = colours([230,97,1],[253,184,99],[146,197,222],[5,113,176]);
const hex = rgb => "#"+rgb.map(c=>c.toString(16).padStart(2,"0")).join("");
const rgbOf = value => /^#[0-9a-f]{6}$/i.test(value) ? [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)) : null;
export function paletteColours(palette) {
  const {white,black} = coloursFor(palette);
  return {whiteSettled:hex(white.rgb),whiteLeaning:hex(white.weak),blackLeaning:hex(black.weak),blackSettled:hex(black.rgb)};
}
/** Sets the custom map from {whiteSettled,...} hex colours; returns false if any is invalid. */
export function setCustomColours(value) {
  const list = COLOUR_KEYS.map(key=>rgbOf(value?.[key]));
  if(list.some(c=>!c))return false;
  custom = colours(...list);
  return true;
}
// The swatches offered for each colour of the custom map, from the presets
// and ColorBrewer's diverging schemes; any other colour can still be picked.
export const PALETTE_COLOUR_CHOICES = Object.freeze({
  whiteSettled:Object.freeze(["#e66101","#00b373","#f6f9ff","#d7301f","#1b7837","#b35806"]),
  whiteLeaning:Object.freeze(["#fdb863","#74ca97","#f6f9ff","#fc8d59","#a6dba0","#f1a340"]),
  blackLeaning:Object.freeze(["#92c5de","#ffbdf4","#161a22","#91bfdb","#c2a5cf","#998ec3"]),
  blackSettled:Object.freeze(["#0571b0","#ca69c8","#161a22","#4575b4","#762a83","#542788"])
});
export const OPACITY_SHAPES = Object.freeze(["V","U"]);
export const DEFAULT_OPACITY_SHAPE = "V";
let shape = DEFAULT_OPACITY_SHAPE;
export const opacityShape = () => shape;
export function setOpacityShape(value) {
  shape = OPACITY_SHAPES.includes(value) ? value : DEFAULT_OPACITY_SHAPE;
  return shape;
}
// "Hide the ownership overlay" is one of the colour-map choices, not a game setting.
export const PALETTE_NONE = "none";
export const DEFAULT_PALETTE = "mono";
export const isPaletteChoice = value => value === PALETTE_NONE || value === PALETTE_CUSTOM || Object.hasOwn(PALETTES, value);
// Stored choices from older versions: purple-green keeps its hues with purple
// moved to Black; removed maps fall back to the default.
export function normalizePalette(value) {
  if(value==="purpleGreen")return "greenPurple";
  return isPaletteChoice(value) ? value : DEFAULT_PALETTE;
}
export const showsOwnership = palette => palette !== PALETTE_NONE;
// The line between leaning and settled colours; the endgame advisor counts
// the same points as "settled". LEANING is kept for the help text and tests.
export const OWNERSHIP_BANDS = Object.freeze({LEANING:.3, SETTLED:.72, BLEND:.1});
const clamp = (v,lo,hi) => Math.min(hi,Math.max(lo,v));
const smoothstep = (edge,x) => {
  const t=clamp((x-edge+OWNERSHIP_BANDS.BLEND)/(2*OWNERSHIP_BANDS.BLEND),0,1);
  return t*t*(3-2*t);
};
const strength = value => Number.isFinite(value) ? clamp(Math.abs(value),0,1) : 0;
function coloursFor(palette) {
  if(palette===PALETTE_CUSTOM)return custom;
  return PALETTES[palette] || PALETTES[DEFAULT_PALETTE];
}
function sideAt(value, palette) {
  const v = Number.isFinite(value) ? value : 0;
  const {white,black} = coloursFor(palette);
  return v > 0 ? black : white;
}
function mix(s, value) {
  const t = smoothstep(OWNERSHIP_BANDS.SETTLED,strength(value));
  return s.rgb.map((c,i)=>Math.round(s.weak[i]+(c-s.weak[i])*t));
}
export function paletteAt(value, palette = DEFAULT_PALETTE) {
  return mix(sideAt(value,palette),value);
}
export function ownershipAlpha(value, opacity = 1, curve = shape) {
  const a=strength(value);
  const max=Number.isFinite(opacity)?clamp(opacity,0,1):0;
  return (curve==="U" ? a*a : a)*max;
}
export function ownershipPixel(value, palette = DEFAULT_PALETTE, opacity = 1) {
  return [...paletteAt(value,palette),Math.round(255*ownershipAlpha(value,opacity))];
}
// The legend runs from Black (left) through neutral (centre) to White (right),
// as every place that shows both sides puts Black first, sampled from the
// same function as the board.
export function paletteGradient(palette = DEFAULT_PALETTE, opacity = 1) {
  const stops=[];
  for(let i=0;i<=40;i++){
    const v=1-i/20;
    const [r,g,b,a]=ownershipPixel(v===0?-0:v,palette,opacity);
    stops.push("rgba("+r+","+g+","+b+","+Number((a/255).toFixed(3))+") "+(i*2.5)+"%");
  }
  return "linear-gradient(90deg,"+stops.join(",")+")";
}
// Counting uses the same colour map as the estimate, but in flat cells:
// soft edges are a guess, hard edges are the count. Counting is never hidden,
// so "表示しない" falls back to the default map and a faint opacity is raised.
export const COUNTING_MIN_OPACITY = .5;
export const countingPalette = palette => showsOwnership(palette) && isPaletteChoice(palette) ? palette : DEFAULT_PALETTE;
export const countingOpacity = opacity => Math.max(Number.isFinite(opacity) ? clamp(opacity,0,1) : 0, COUNTING_MIN_OPACITY);
// The counting legend: Black's area | neutral (a small ring, as on the board) | White's area.
export function countingGradient(palette = DEFAULT_PALETTE, opacity = 1) {
  const {white,black} = coloursFor(countingPalette(palette));
  const fill = s => "rgba("+s.rgb.join(",")+","+Number(ownershipAlpha(1,countingOpacity(opacity)).toFixed(3))+")";
  return "radial-gradient(circle at 50% 50%,transparent 2.4px,"+NEUTRAL_MARK+" 2.4px 3.6px,transparent 3.6px),"+
    "linear-gradient(90deg,"+fill(black)+" 0 33%,transparent 33% 67%,"+fill(white)+" 67% 100%)";
}
export const NEUTRAL_MARK = "rgba(96,92,84,.85)";
// 日本式: prisoners filled into territory and the アゲハマ counter wear the
// colour of the side that took them, so each block reads as that side's
// points and shows against the area it sits in. `white` outlines White stones
// (Black's prisoners), so it is Black's colour, and the other way round.
export function prisonerOutline(palette = DEFAULT_PALETTE) {
  const {white,black} = coloursFor(countingPalette(palette));
  return {white:hex(black.rgb),black:hex(white.rgb)};
}
// The estimate as the board shows it. MieGO's estimate is one pass of a small
// network, which stays unsure of plainly closed territory (on a won 19x19
// board, often when the winner is to move). So an area the estimate already
// gives to one side, and that is closed off by that side's living stones
// alone, is shown as settled. Groups the estimate gives, on average, to the
// other side count as dead stones inside the area; walls it is unsure of
// (seki) close nothing. 日本式 counts territory, not stones: living stones are left clear,
// while a dead stone's point, territory once it is lifted, keeps its colour.
const SETTLED_WALL = .5;
export function shownOwnership(board, values, {japanese=false}={}) {
  if(!Array.isArray(board) || !Array.isArray(values) || values.length!==board.length)return values;
  const size=sizeOf(board), side=values.map(v=>Number.isFinite(v)?v:0);
  // Each stone's group's mean ownership, signed for its own colour.
  const control=Array(board.length).fill(0);
  for(const g of groups(board)){
    const mean=[...g.stones].reduce((sum,p)=>sum+g.color*side[p],0)/g.stones.size;
    for(const p of g.stones)control[p]=mean;
  }
  const living=p=>board[p] && control[p]>0;
  const shown=[...side], seen=new Set();
  for(let start=0;start<board.length;start++){
    if(living(start) || seen.has(start))continue;
    const area=[start], walls=new Set(); seen.add(start);
    let firm=true;
    for(let head=0;head<area.length;head++){
      for(const n of neighbors(area[head],size)){
        if(living(n)){walls.add(board[n]);if(control[n]<SETTLED_WALL)firm=false;}
        else if(!seen.has(n)){seen.add(n);area.push(n);}
      }
    }
    // An area reaching all four edges is the open board, not a closed area.
    const edges=new Set();
    for(const p of area){
      const x=p%size,y=Math.floor(p/size);
      if(x===0)edges.add("left");if(x===size-1)edges.add("right");
      if(y===0)edges.add("top");if(y===size-1)edges.add("bottom");
    }
    if(!firm || walls.size!==1 || edges.size===4)continue;
    const owner=[...walls][0];
    if(area.every(p=>board[p] || owner*side[p]>0))for(const p of area)shown[p]=owner;
  }
  if(japanese)for(let p=0;p<board.length;p++)if(living(p))shown[p]=0;
  return shown;
}
export function interpolateOwnership(from,to,progress) {
  const t=clamp(progress,0,1);
  if (!Array.isArray(to) || ![81,169,361].includes(to.length)) throw new Error("Invalid ownership map");
  if (!Array.isArray(from) || from.length!==to.length) return [...to];
  return to.map((value,i)=>from[i]*(1-t)+value*t);
}
