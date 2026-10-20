import {stanceOf,STYLE_AXES} from "./ai-personality.mjs";
import {normalizeStrength} from "./ai-strength.mjs";
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
  steady: define("easy", {invasion:0, stance:0}),
  raider: define("easy", {height:0, invasion:100}),
  brawler: define("normal", {stance:100, tenuki:0}),
  wide: define("normal", {height:100, tenuki:100}),
  serious: define("strong"),
});
export const CUSTOM_CHARACTER = "custom";
export const DEFAULT_AI_CHARACTER = "steady";

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
