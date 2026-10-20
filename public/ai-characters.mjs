import {stanceOf,STYLE_AXES} from "./ai-personality.mjs";
import {AI_STRENGTHS,normalizeStrength} from "./ai-strength.mjs";
import {TEXT} from "./texts.mjs";

// A character is a strength plus a value on each style axis (0, 50 or 100,
// 50 neutral). Picking one sets everything; カスタム keeps the player's own
// values. The two pairs (raider/steady, brawler/wide) share a strength, so a
// COM-vs-COM game between them is decided by style rather than strength.
// Axes a character leaves out stay at 50.
const define = (strength, style={}) => Object.freeze({strength,
  ...Object.fromEntries(STYLE_AXES.map(axis=>[axis,style[axis] ?? 50]))});
export const AI_CHARACTERS = Object.freeze({
  chick: define("beginner"),
  steady: define("easy", {stance:0}),
  raider: define("easy", {height:0, stance:100}),
  brawler: define("normal", {stance:100, tenuki:0}),
  wide: define("normal", {height:100, tenuki:100}),
  serious: define("strong"),
  // 最強 plays KataGo's own choice from a larger network and ignores style.
  master: define("strongest"),
});
export const CUSTOM_CHARACTER = "custom";
export const DEFAULT_AI_CHARACTER = "chick";

// Saved settings hold any 0-100 value; every axis has three stops.
const step = value => Math.round(Math.max(0,Math.min(100,Number(value ?? 50) || 0))/50)*50;

/** A COM's full settings, with any missing or out-of-range field made valid. */
export function normalizeCom(com={}, fallbackStrength="strong") {
  const values={...com,stance:stanceOf(com)};
  return {strength:normalizeStrength(com.strength,fallbackStrength),
    ...Object.fromEntries(STYLE_AXES.map(axis=>[axis,step(values[axis])]))};
}

/** The character whose settings a COM matches exactly, or カスタム. */
export function characterOf(com) {
  const clean=normalizeCom(com);
  const found=Object.entries(AI_CHARACTERS).find(([,c])=>
    c.strength===clean.strength && STYLE_AXES.every(axis=>c[axis]===clean[axis]));
  return found ? found[0] : CUSTOM_CHARACTER;
}

/** The settings a character stands for; カスタム keeps the given COM's own. */
export function comFor(key, custom={}) {
  return Object.hasOwn(AI_CHARACTERS,key) ? {...AI_CHARACTERS[key]} : normalizeCom(custom);
}

export const characterLabel = key => TEXT.ai.characters[key]?.name ?? TEXT.ai.characters.custom.name;
export const characterNote = key => TEXT.ai.characters[key]?.note ?? TEXT.ai.characters.custom.note;

/** A COM as the app keeps it: the chosen character plus the values it plays with. */
export function pickCharacter(com, key) {
  if(Object.hasOwn(AI_CHARACTERS,key))return {character:key,...AI_CHARACTERS[key]};
  // カスタム starts from the values the COM plays with now.
  return {...normalizeCom(com),character:CUSTOM_CHARACTER};
}

/** A saved COM, including saves from before characters (strength, 侵入度 and 補強度
 * alone) and before 侵入度 joined 攻守: each reads as the character it matches, or カスタム. */
export function readCom(value, fallbackStrength="strong") {
  const values=normalizeCom(value ?? {},fallbackStrength);
  const key=value?.character;
  if(key===CUSTOM_CHARACTER)return {...values,character:CUSTOM_CHARACTER};
  return pickCharacter(values,Object.hasOwn(AI_CHARACTERS,key) ? key : characterOf(values));
}

/** Replaces one value of a COM; any change makes it カスタム. */
export function setComValue(com, axis, value) {
  return readCom({...com,character:CUSTOM_CHARACTER,[axis]:value});
}

// Each axis's name and the labels of its three stops (0, 50, 100), in the order the sheet lists them.
export const AXIS_TEXT = Object.freeze({
  stance: {name:TEXT.ai.stance, stops:TEXT.ai.stanceStops},
  height: {name:TEXT.ai.height, stops:TEXT.ai.heightStops},
  tenuki: {name:TEXT.ai.tenuki, stops:TEXT.ai.tenukiStops},
});
export const stopLabel = (axis, value) => {
  const stops=AXIS_TEXT[axis].stops;
  return value<50 ? stops.low : value>50 ? stops.high : stops.mid;
};

/** One line naming a COM's strength and every axis it leans on. */
export function comSummary(com) {
  const clean=normalizeCom(com);
  const leans=Object.keys(AXIS_TEXT).filter(axis=>clean[axis]!==50)
    .map(axis=>[AXIS_TEXT[axis].name,stopLabel(axis,clean[axis])]);
  return TEXT.ai.comSummary(AI_STRENGTHS[clean.strength].label,leans);
}
