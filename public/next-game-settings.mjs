// The 新規対戦 sheet's choices, remembered in this browser for the next game.
import { BOARD_SIZES, handicapOf, maxHandicap, RULESETS } from "./core.mjs";

const SETTINGS_KEY = "miego-local-settings";

/** The remembered choices, or null when there are none. Unreadable JSON throws. */
export const readSettings = storage => JSON.parse(storage.getItem(SETTINGS_KEY) || "null");

/** Keeps the choices; a full or blocked storage leaves the previous ones. */
export function writeSettings(storage, settings) {
  try { storage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch {}
}

export const toBoardSize = value => BOARD_SIZES.includes(Number(value)) ? Number(value) : 9;
// Up to nine stones; newGame() caps the count for the chosen board (9x9: five).
export const toHandicap = value => handicapOf({handicap:Number(value)}, 19);
export const toRules = value => RULESETS.includes(value) ? value : "chinese";
export const toSeconds = (value, choices) => choices.includes(Number(value)) ? Number(value) : 0;

/** Each mode's handicap, reduced to what the board has star points for (9x9: five). */
export function capHandicaps(handicaps, size) {
  const max = maxHandicap(size);
  return Object.fromEntries(Object.entries(handicaps).map(([mode, count]) => [mode, Math.min(count, max)]));
}
