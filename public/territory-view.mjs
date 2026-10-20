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
// The legend runs from White (left) through neutral (centre) to Black (right),
// sampled from the same function as the board.
export function paletteGradient(palette = DEFAULT_PALETTE, opacity = 1) {
  const stops=[];
  for(let i=0;i<=40;i++){
    const v=i/20-1;
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
// The counting legend: White's area | neutral (a small ring, as on the board) | Black's area.
export function countingGradient(palette = DEFAULT_PALETTE, opacity = 1) {
  const {white,black} = coloursFor(countingPalette(palette));
  const fill = s => "rgba("+s.rgb.join(",")+","+Number(ownershipAlpha(1,countingOpacity(opacity)).toFixed(3))+")";
  return "radial-gradient(circle at 50% 50%,transparent 2.4px,"+NEUTRAL_MARK+" 2.4px 3.6px,transparent 3.6px),"+
    "linear-gradient(90deg,"+fill(white)+" 0 33%,transparent 33% 67%,"+fill(black)+" 67% 100%)";
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
export function interpolateOwnership(from,to,progress) {
  const t=clamp(progress,0,1);
  if (!Array.isArray(to) || ![81,169,361].includes(to.length)) throw new Error("Invalid ownership map");
  if (!Array.isArray(from) || from.length!==to.length) return [...to];
  return to.map((value,i)=>from[i]*(1-t)+value*t);
}
