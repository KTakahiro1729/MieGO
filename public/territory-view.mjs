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
    wood: sides(side([246,249,255],[196,204,216],3),side([22,26,34],[82,88,100],.65)),
    light: sides(side([255,255,255],[226,230,236],2.5),side([16,20,28],[72,78,90],.7)),
    dark: sides(side([240,248,255],[150,166,182],.5),side([0,2,8],[14,20,30],2.6))
  }),
  // ColorBrewer 5-class PuOr / PRGn (outer and inner hues), re-lit per board.
  orangePurple: Object.freeze({
    wood: sides(side([230,97,1],[253,184,99],1.5),side([94,60,153],[178,171,210],.8)),
    light: sides(side([230,97,1],[253,184,99],1.3),side([94,60,153],[178,171,210],.95)),
    dark: sides(side([245,150,50],[253,200,140],.7),side([120,80,190],[178,171,210],1.5))
  }),
  greenPurple: Object.freeze({
    wood: sides(side([90,190,120],[166,219,160],2.2),side([84,39,120],[194,165,207],.75)),
    light: sides(side([90,190,120],[166,219,160],2.2),side([84,39,120],[194,165,207],.75)),
    dark: sides(side([110,215,160],[180,235,190],.7),side([120,80,190],[194,165,207],1.5))
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
// Opacity follows |v|^(1/1.33) so leanings near neutral are still visible.
export const OWNERSHIP_GAMMA = 1.33;
const clamp = (v,lo,hi) => Math.min(hi,Math.max(lo,v));
function sidesFor(palette, theme) {
  const map = PALETTES[palette] || PALETTES[DEFAULT_PALETTE];
  return map[isBoardTheme(theme) ? theme : DEFAULT_BOARD_THEME];
}
function sideAt(value, palette, theme) {
  const v = Number.isFinite(value) ? value : 0;
  const {white,black} = sidesFor(palette,theme);
  return v > 0 ? black : white;
}
// The side's colour at strength |v|: its weak colour near neutral, its strong one at 1.
function mix(s, value) {
  const t = Number.isFinite(value) ? clamp(Math.abs(value),0,1) : 0;
  return s.rgb.map((c,i)=>Math.round(s.weak[i]+(c-s.weak[i])*t));
}
export function paletteAt(value, palette = DEFAULT_PALETTE, theme = DEFAULT_BOARD_THEME) {
  return mix(sideAt(value,palette,theme),value);
}
export function ownershipAlpha(value, opacity = 1, gain = 1) {
  const v=Number.isFinite(value)?clamp(value,-1,1):0;
  const max=Number.isFinite(opacity)?clamp(opacity,0,1):0;
  const base=Math.abs(v)**(1/OWNERSHIP_GAMMA)*max;
  const g=Number.isFinite(gain)&&gain>0?gain:1;
  return clamp(1-(1-base)**g,0,1);
}
export function ownershipPixel(value, palette = DEFAULT_PALETTE, opacity = 1, theme = DEFAULT_BOARD_THEME) {
  const s = sideAt(value,palette,theme);
  return [...mix(s,value),Math.round(255*ownershipAlpha(value,opacity,s.gain))];
}
// The legend runs from White (left) through neutral (centre) to Black (right).
export function paletteGradient(palette = DEFAULT_PALETTE, opacity = 1, theme = DEFAULT_BOARD_THEME) {
  const {white,black} = sidesFor(palette,theme);
  const stop = (s,v,at) => "rgba("+mix(s,v).join(",")+","+
    Number(ownershipAlpha(v,opacity,s.gain).toFixed(3))+") "+at+"%";
  const levels = [1,.75,.5,.25,0];
  return "linear-gradient(90deg,"+[
    ...levels.map(v=>stop(white,v,(1-v)*50)),
    ...[...levels].reverse().map(v=>stop(black,v,50+v*50))
  ].join(",")+")";
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
