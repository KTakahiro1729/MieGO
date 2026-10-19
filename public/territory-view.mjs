import {DEFAULT_BOARD_THEME, isBoardTheme} from "./board-theme.mjs";

// Values are ownership tendencies (-1 white, +1 black), not win probabilities.
// A neutral ownership value (0) is fully transparent: the board is visible.
// Each colour map has two colours per side and per board look, so the scale
// has five steps: strong White, weak White, neutral, weak Black, strong Black.
// A point's colour slides from the side's weak colour (near neutral) to its
// strong colour (|v| = 1). `gain` bends that side's opacity so both sides
// stand out from that board by about the same amount (white on a light board
// needs more, black on a dark one). Full opacity stays full colour on both sides.
// Purple is always Black's side.
const side = (rgb,weak,gain) => Object.freeze({rgb:Object.freeze(rgb),weak:Object.freeze(weak),gain});
const sides = (white,black) => Object.freeze({white,black});
export const PALETTES = Object.freeze({
  mono: Object.freeze({
    wood: sides(side([246,249,255],[191,195,205],4.5),side([22,26,34],[43,47,57],1)),
    light: sides(side([255,255,255],[222,234,255],3.2),side([16,20,28],[58,63,76],.75)),
    dark: sides(side([240,248,255],[178,196,224],.6),side([0,2,8],[13,17,27],2.5))
  }),
  // After matplotlib's diverging maps. The inner colour is not a paler
  // in-between: it shifts hue within the side, so a leaning point still says
  // which side it leans to. PuOr's orange and purple with managua's amber
  // and vanimo's magenta for the leaning steps. Leaning colours and gains
  // are tuned per board so every step stays apart (CIELAB distance) from
  // the board and from its neighbours at the default strength.
  orangePurple: Object.freeze({
    wood: sides(side([214,88,0],[255,225,40],2),side([84,39,143],[230,95,200],1.2)),
    light: sides(side([214,88,0],[255,190,30],1.5),side([84,39,143],[225,100,205],1.4)),
    dark: sides(side([245,140,40],[255,235,140],1),side([150,100,230],[240,120,200],2.2))
  }),
  // PRGn's green and purple with PiYG's lime and pink for the leaning steps.
  greenPurple: Object.freeze({
    wood: sides(side([27,120,55],[180,240,55],1.6),side([118,42,131],[235,80,150],1.2)),
    light: sides(side([27,120,55],[160,215,50],1.6),side([118,42,131],[240,95,155],1.35)),
    dark: sides(side([90,200,110],[215,245,140],1),side([160,100,220],[240,110,180],2.2))
  })
});
// "Hide the ownership overlay" is one of the colour-map choices, not a game setting.
export const PALETTE_NONE = "none";
export const DEFAULT_PALETTE = "mono";
export const isPaletteChoice = value => value === PALETTE_NONE || Object.hasOwn(PALETTES, value);
// Stored choices from older versions: purple-green keeps its hues with purple
// moved to Black; removed maps fall back to the default.
export function normalizePalette(value) {
  if(value==="purpleGreen")return "greenPurple";
  return isPaletteChoice(value) ? value : DEFAULT_PALETTE;
}
export const showsOwnership = palette => palette !== PALETTE_NONE;
// The five colours are bands with a meaning, not a smooth ramp:
//   |v| <  LEANING  neutral, almost no colour;
//   |v| >= LEANING  the side's weak colour: leaning that way, not decided;
//   |v| >= SETTLED  the side's strong colour: as good as decided.
// SETTLED is the same line the endgame advisor counts as "settled", so a
// board that is nearly all strong colour is a board where scoring is offered.
// Bands meet over a short blend so the board does not look posterized.
export const OWNERSHIP_BANDS = Object.freeze({LEANING:.3, SETTLED:.72, BLEND:.05});
// Overlay strength (before the opacity slider) of each band.
const NEUTRAL_LEVEL = .1, LEANING_LEVEL = .6;
const clamp = (v,lo,hi) => Math.min(hi,Math.max(lo,v));
const smoothstep = (edge,x) => {
  const t=clamp((x-edge+OWNERSHIP_BANDS.BLEND)/(2*OWNERSHIP_BANDS.BLEND),0,1);
  return t*t*(3-2*t);
};
const strength = value => Number.isFinite(value) ? clamp(Math.abs(value),0,1) : 0;
function sidesFor(palette, theme) {
  const map = PALETTES[palette] || PALETTES[DEFAULT_PALETTE];
  return map[isBoardTheme(theme) ? theme : DEFAULT_BOARD_THEME];
}
function sideAt(value, palette, theme) {
  const v = Number.isFinite(value) ? value : 0;
  const {white,black} = sidesFor(palette,theme);
  return v > 0 ? black : white;
}
// The side's colour: weak below SETTLED, strong from it.
function mix(s, value) {
  const t = smoothstep(OWNERSHIP_BANDS.SETTLED,strength(value));
  return s.rgb.map((c,i)=>Math.round(s.weak[i]+(c-s.weak[i])*t));
}
export function paletteAt(value, palette = DEFAULT_PALETTE, theme = DEFAULT_BOARD_THEME) {
  return mix(sideAt(value,palette,theme),value);
}
export function ownershipAlpha(value, opacity = 1, gain = 1) {
  const a=strength(value);
  const max=Number.isFinite(opacity)?clamp(opacity,0,1):0;
  const neutral=NEUTRAL_LEVEL*Math.min(a/(OWNERSHIP_BANDS.LEANING-OWNERSHIP_BANDS.BLEND),1);
  const leaning=neutral+(LEANING_LEVEL-neutral)*smoothstep(OWNERSHIP_BANDS.LEANING,a);
  const level=leaning+(1-leaning)*smoothstep(OWNERSHIP_BANDS.SETTLED,a);
  const g=Number.isFinite(gain)&&gain>0?gain:1;
  return clamp(1-(1-level*max)**g,0,1);
}
export function ownershipPixel(value, palette = DEFAULT_PALETTE, opacity = 1, theme = DEFAULT_BOARD_THEME) {
  const s = sideAt(value,palette,theme);
  return [...mix(s,value),Math.round(255*ownershipAlpha(value,opacity,s.gain))];
}
// The legend runs from White (left) through neutral (centre) to Black (right),
// sampled from the same function as the board so its bands line up with it.
export function paletteGradient(palette = DEFAULT_PALETTE, opacity = 1, theme = DEFAULT_BOARD_THEME) {
  const stops=[];
  for(let i=0;i<=40;i++){
    const v=i/20-1;
    const [r,g,b,a]=ownershipPixel(v===0?-0:v,palette,opacity,theme);
    stops.push("rgba("+r+","+g+","+b+","+Number((a/255).toFixed(3))+") "+(i*2.5)+"%");
  }
  return "linear-gradient(90deg,"+stops.join(",")+")";
}
// Counting uses the same colour map as the estimate, but in flat cells:
// soft edges are a guess, hard edges are the count. Counting is never hidden,
// so "表示しない" falls back to the default map and a faint opacity is raised.
export const COUNTING_MIN_OPACITY = .5;
export const countingPalette = palette => showsOwnership(palette) && Object.hasOwn(PALETTES, palette) ? palette : DEFAULT_PALETTE;
export const countingOpacity = opacity => Math.max(Number.isFinite(opacity) ? clamp(opacity,0,1) : 0, COUNTING_MIN_OPACITY);
// The counting legend: White's area | neutral (a small ring, as on the board) | Black's area.
export function countingGradient(palette = DEFAULT_PALETTE, opacity = 1, theme = DEFAULT_BOARD_THEME) {
  const {white,black} = sidesFor(countingPalette(palette),theme);
  const fill = s => "rgba("+s.rgb.join(",")+","+Number(ownershipAlpha(1,countingOpacity(opacity),s.gain).toFixed(3))+")";
  return "radial-gradient(circle at 50% 50%,transparent 2.4px,"+NEUTRAL_MARK+" 2.4px 3.6px,transparent 3.6px),"+
    "linear-gradient(90deg,"+fill(white)+" 0 33%,transparent 33% 67%,"+fill(black)+" 67% 100%)";
}
export const NEUTRAL_MARK = "rgba(96,92,84,.85)";
export function interpolateOwnership(from,to,progress) {
  const t=clamp(progress,0,1);
  if (!Array.isArray(to) || ![81,169,361].includes(to.length)) throw new Error("Invalid ownership map");
  if (!Array.isArray(from) || from.length!==to.length) return [...to];
  return to.map((value,i)=>from[i]*(1-t)+value*t);
}
