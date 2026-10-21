import {stanceOf,STYLE_AXES} from "./ai-personality.mjs";
import {AI_STRENGTHS,normalizeStrength} from "./ai-strength.mjs";
import {TEXT} from "./texts.mjs";

// A character is a value on each style axis (0, 50 or 100, 50 neutral): how
// the COM plays, not how well. Strength is chosen on its own, so any character
// plays at any strength, and at one strength the characters are about evenly
// matched against each other (docs/AI_PERSONALITIES.md). Picking one sets
// every axis; カスタム keeps the player's own values. Axes a character leaves
// out stay at 50. 終局の提案 (kept as resign) is not a style of play but when
// the COM offers to end a lost game; it starts at 0, playing every game out.
export const COM_AXES = Object.freeze([...STYLE_AXES, "resign"]);
const AXIS_DEFAULT = Object.freeze({resign:0});
const axisDefault = axis => AXIS_DEFAULT[axis] ?? 50;
const define = (style={}) => Object.freeze(
  Object.fromEntries(COM_AXES.map(axis=>[axis,style[axis] ?? axisDefault(axis)])));
export const AI_CHARACTERS = Object.freeze({
  plain: define(),
  steady: define({stance:0}),
  raider: define({height:0, stance:100}),
  brawler: define({stance:100, tenuki:0}),
  wide: define({height:100, tenuki:100}),
});
export const CUSTOM_CHARACTER = "custom";
export const DEFAULT_AI_CHARACTER = "plain";

// Saved settings hold any 0-100 value; every axis has three stops.
const step = (value, fallback=50) => Math.round(Math.max(0,Math.min(100,Number(value ?? fallback) || 0))/50)*50;

/** A COM's full settings, with any missing or out-of-range field made valid. */
export function normalizeCom(com={}, fallbackStrength="strong") {
  const values={...com,stance:stanceOf(com)};
  return {strength:normalizeStrength(com.strength,fallbackStrength),
    ...Object.fromEntries(COM_AXES.map(axis=>[axis,step(values[axis],axisDefault(axis))]))};
}

/** The character whose style a COM matches exactly, at any strength, or カスタム. */
export function characterOf(com) {
  const clean=normalizeCom(com);
  const found=Object.entries(AI_CHARACTERS).find(([,c])=>
    COM_AXES.every(axis=>c[axis]===clean[axis]));
  return found ? found[0] : CUSTOM_CHARACTER;
}

/** A COM's settings with a character's style; カスタム keeps the given COM's own.
 * The strength is the given COM's either way. */
export function comFor(key, custom={}) {
  const clean=normalizeCom(custom);
  return Object.hasOwn(AI_CHARACTERS,key) ? {...clean,...AI_CHARACTERS[key]} : clean;
}

export const characterLabel = key => TEXT.ai.characters[key]?.name ?? TEXT.ai.characters.custom.name;
export const characterNote = key => TEXT.ai.characters[key]?.note ?? TEXT.ai.characters.custom.note;

/** A COM as the app keeps it: the chosen character plus the values it plays with. */
export function pickCharacter(com, key) {
  if(Object.hasOwn(AI_CHARACTERS,key))return {character:key,...comFor(key,com)};
  // カスタム starts from the values the COM plays with now.
  return {...normalizeCom(com),character:CUSTOM_CHARACTER};
}

/** A saved COM, including saves from before characters (strength, 侵入度 and 補強度
 * alone), before 侵入度 joined 攻守 and before strength left the characters
 * (ひよこ, 本気 and 名人 were the neutral style at 入門, つよい and 最強): each
 * reads as the character it matches, or カスタム, keeping its strength. */
export function readCom(value, fallbackStrength="strong") {
  const values=normalizeCom(value ?? {},fallbackStrength);
  const key=value?.character;
  if(key===CUSTOM_CHARACTER)return {...values,character:CUSTOM_CHARACTER};
  return pickCharacter(values,Object.hasOwn(AI_CHARACTERS,key) ? key : characterOf(values));
}

/** Replaces one value of a COM. A new strength keeps the character; any other
 * change makes it カスタム. */
export function setComValue(com, axis, value) {
  if(axis==="strength")return readCom({...com,strength:value});
  return readCom({...com,character:CUSTOM_CHARACTER,[axis]:value});
}

// Each axis's name and the labels of its three stops (0, 50, 100), in the order the sheet lists them.
export const AXIS_TEXT = Object.freeze({
  stance: {name:TEXT.ai.stance, stops:TEXT.ai.stanceStops},
  height: {name:TEXT.ai.height, stops:TEXT.ai.heightStops},
  tenuki: {name:TEXT.ai.tenuki, stops:TEXT.ai.tenukiStops},
  resign: {name:TEXT.ai.resign, stops:TEXT.ai.resignStops},
});
export const stopLabel = (axis, value) => {
  const stops=AXIS_TEXT[axis].stops;
  return value<50 ? stops.low : value>50 ? stops.high : stops.mid;
};

/** One line naming a COM's strength and every axis it leans on. 最強 plays the
 * larger network's own choice, so its line says it leaves the style axes aside. */
export function comSummary(com) {
  const clean=normalizeCom(com);
  const leaning=Object.keys(AXIS_TEXT).filter(axis=>clean[axis]!==axisDefault(axis));
  const strongest=clean.strength==="strongest";
  const shown=strongest ? leaning.filter(axis=>!STYLE_AXES.includes(axis)) : leaning;
  const line=TEXT.ai.comSummary(AI_STRENGTHS[clean.strength].label,
    shown.map(axis=>[AXIS_TEXT[axis].name,stopLabel(axis,clean[axis])]));
  return strongest && shown.length<leaning.length ? line+TEXT.ai.strongestNoStyle : line;
}
