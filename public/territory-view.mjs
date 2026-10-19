import {DEFAULT_BOARD_THEME, isBoardTheme} from "./board-theme.mjs";

// Values are ownership tendencies (-1 white, +1 black), not win probabilities.
// A neutral ownership value (0) is fully transparent: the board is visible.
// Each colour map has one colour per side and per board look. `gain` bends
// that side's opacity so both sides stand out from that board by about the
// same amount (white on a light board needs more, black on a dark one).
// Full opacity stays full colour on both sides.
// Purple is always Black's side.
const side = (rgb,gain) => Object.freeze({rgb:Object.freeze(rgb),gain});
const sides = (white,black) => Object.freeze({white,black});
export const PALETTES = Object.freeze({
  mono: Object.freeze({
    wood: sides(side([246,249,255],3),side([22,26,34],.65)),
    light: sides(side([255,255,255],2.5),side([16,20,28],.7)),
    dark: sides(side([240,248,255],.5),side([0,2,8],2.6))
  }),
  // ColorBrewer PuOr / PRGn hues, re-lit per board.
  orangePurple: Object.freeze({
    wood: sides(side([230,97,1],1.5),side([94,60,153],.8)),
    light: sides(side([230,97,1],1.3),side([94,60,153],.95)),
    dark: sides(side([245,150,50],.7),side([120,80,190],1.5))
  }),
  greenPurple: Object.freeze({
    wood: sides(side([90,190,120],2.2),side([84,39,120],.75)),
    light: sides(side([90,190,120],2.2),side([84,39,120],.75)),
    dark: sides(side([110,215,160],.7),side([120,80,190],1.5))
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
export function paletteAt(value, palette = DEFAULT_PALETTE, theme = DEFAULT_BOARD_THEME) {
  return sideAt(value,palette,theme).rgb;
}
export function ownershipAlpha(value, opacity = 1, gain = 1) {
  const v=Number.isFinite(value)?clamp(value,-1,1):0;
  const max=Number.isFinite(opacity)?clamp(opacity,0,1):0;
  const base=Math.abs(v)**(1/OWNERSHIP_GAMMA)*max;
  const g=Number.isFinite(gain)&&gain>0?gain:1;
  return clamp(1-(1-base)**g,0,1);
}
export function ownershipPixel(value, palette = DEFAULT_PALETTE, opacity = 1, theme = DEFAULT_BOARD_THEME) {
  const {rgb,gain} = sideAt(value,palette,theme);
  return [...rgb,Math.round(255*ownershipAlpha(value,opacity,gain))];
}
// The legend runs from White (left) through neutral (centre) to Black (right).
export function paletteGradient(palette = DEFAULT_PALETTE, opacity = 1, theme = DEFAULT_BOARD_THEME) {
  const {white,black} = sidesFor(palette,theme);
  const stop = (s,v,at) => "rgba("+s.rgb.join(",")+","+
    Number(ownershipAlpha(v,opacity,s.gain).toFixed(3))+") "+at+"%";
  const levels = [1,.75,.5,.25,0];
  return "linear-gradient(90deg,"+[
    ...levels.map(v=>stop(white,v,(1-v)*50)),
    ...[...levels].reverse().map(v=>stop(black,v,50+v*50))
  ].join(",")+")";
}
export function interpolateOwnership(from,to,progress) {
  const t=clamp(progress,0,1);
  if (!Array.isArray(to) || to.length!==81) throw new Error("Invalid ownership map");
  if (!Array.isArray(from) || from.length!==to.length) return [...to];
  return to.map((value,i)=>from[i]*(1-t)+value*t);
}
