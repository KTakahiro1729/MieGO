// Presentation-only helpers. Values are ownership tendencies (-1 white, +1 black), not win probabilities.
export const PALETTES = Object.freeze({
  mono: [[249,247,238],[169,169,164],[27,32,38]],
  purpleGreen: [[133,75,177],[215,205,178],[37,132,91]],
  blueRed: [[65,111,179],[224,214,194],[184,69,82]]
});
const clamp = (v,lo,hi) => Math.min(hi,Math.max(lo,v));
export function paletteAt(value, palette = "mono") {
  const stops = PALETTES[palette] || PALETTES.mono;
  const position = (clamp(Number.isFinite(value) ? value : 0,-1,1)+1)/2;
  const first = position<=.5?stops[0]:stops[1];
  const second = position<=.5?stops[1]:stops[2];
  const t = position<=.5?position*2:(position-.5)*2;
  return first.map((c,i)=>Math.round(c*(1-t)+second[i]*t));
}
export function paletteGradient(palette = "mono") {
  return "linear-gradient(90deg,"+(PALETTES[palette]||PALETTES.mono).map(c=>"rgb("+c.join(",")+")").join(",")+")";
}
export function interpolateOwnership(from,to,progress) {
  const t=clamp(progress,0,1);
  if (!Array.isArray(to) || to.length!==81) throw new Error("Invalid ownership map");
  if (!Array.isArray(from) || from.length!==to.length) return [...to];
  return to.map((value,i)=>from[i]*(1-t)+value*t);
}
