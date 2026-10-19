import { BOARD_AREA } from "./fastBoard";

/** MieGO's MVP currently supports simple-ko Chinese rules only.
 * A positional/situational superko ruleset must use a full repetition history.
 */
export function positionSuperkoBans(args: { rules: string }): Uint8Array {
  if (args.rules !== "chinese") throw new Error("KataGo adapter supports Chinese simple-ko only");
  return new Uint8Array(BOARD_AREA);
}
