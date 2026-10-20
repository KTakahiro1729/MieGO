import { BOARD_AREA } from "./fastBoard";
import { rulesOf } from "../../utils/goRules";
import type { GameRules } from "../../types";

/** MieGO plays simple-ko rulesets only (Chinese and Japanese), which ban no
 * extra points. A positional/situational superko ruleset must use a full
 * repetition history.
 */
export function positionSuperkoBans(args: { rules: string }): Uint8Array {
  if (rulesOf(args.rules as GameRules).ko !== "simple") throw new Error("KataGo adapter supports simple-ko rules only");
  return new Uint8Array(BOARD_AREA);
}
