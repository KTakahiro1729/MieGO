// Values are ownership tendencies (-1 white, +1 black), not win probabilities.
// A neutral ownership value (0) is fully transparent: the board is visible.
export const PALETTES = Object.freeze({
  mono: [[249,247,238],[169,169,164],[27,32,38]],
  purpleGreen: [[133,75,177],[215,205,178],[37,132,91]],
  blueRed: [[65,111,179],[224,214,194],[184,69,82]],
  // ColorBrewer diverging endpoints (BrBG, PuOr), chosen to stay distinct for
  // common colour-vision deficiencies.
  brownTeal: [[140,81,10],[222,212,190],[1,102,94]],
  orangePurple: [[179,88,6],[222,212,190],[84,39,136]]
});
// "Hide the ownership overlay" is one of the colour-map choices, not a game setting.
export const PALETTE_NONE = "none";
export const isPaletteChoice = value => value === PALETTE_NONE || Object.hasOwn(PALETTES, value);
export const showsOwnership = palette => palette !== PALETTE_NONE;
const clamp = (v,lo,hi) => Math.min(hi,Math.max(lo,v));
export function paletteAt(value, palette = "mono") {
  const stops = PALETTES[palette] || PALETTES.mono;
  const v = Number.isFinite(value) ? value : 0;
  return v < 0 ? stops[0] : v > 0 ? stops[2] : stops[1];
}
export function ownershipAlpha(value, opacity = 1) {
  const v=Number.isFinite(value)?clamp(value,-1,1):0;
  const max=Number.isFinite(opacity)?clamp(opacity,0,1):0;
  return Math.abs(v)*max;
}
export function ownershipPixel(value, palette = "mono", opacity = 1) {
  return [...paletteAt(value,palette),Math.round(255*ownershipAlpha(value,opacity))];
}
export function paletteGradient(palette = "mono", opacity = 1) {
  const stops = PALETTES[palette] || PALETTES.mono;
  const left=stops[0].join(","),right=stops[2].join(",");
  const max=Number.isFinite(opacity)?clamp(opacity,0,1):0;
  return "linear-gradient(90deg,rgba("+left+","+max+") 0%,rgba("+left+",0) 50%,rgba("+right+",0) 50%,rgba("+right+","+max+") 100%)";
}
export function interpolateOwnership(from,to,progress) {
  const t=clamp(progress,0,1);
  if (!Array.isArray(to) || ![81,169,361].includes(to.length)) throw new Error("Invalid ownership map");
  if (!Array.isArray(from) || from.length!==to.length) return [...to];
  return to.map((value,i)=>from[i]*(1-t)+value*t);
}
