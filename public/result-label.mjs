import { TEXT } from "./texts.mjs";
// One wording for game results everywhere (score box, history, shared card).
// Written so a beginner can read it without Go jargon (no 中押し or 目半):
// who won, and by what — points as a decimal, or the loser's resignation.
const OTHER = {B:"W",W:"B"};

/** Japanese wording for an SGF-style result such as "B+3.5" or "W+R"; null if unknown. */
export function resultLabel(result) {
  if(typeof result!=="string" || !result)return null;
  if(/^(0|Draw|Jigo)$/i.test(result))return TEXT.result.draw;
  if(/^Void$/i.test(result))return TEXT.result.void;
  const match=/^([BW])\+(.*)$/.exec(result);
  if(!match)return null;
  const [,side,detail]=match;
  if(/^R(esign)?$/i.test(detail))return TEXT.result.byResign(side,OTHER[side]);
  if(/^T(ime)?$/i.test(detail))return TEXT.result.byTime(side,OTHER[side]);
  if(/^\d+(\.\d+)?$/.test(detail))return TEXT.result.byPoints(side,Number(detail).toFixed(1));
  return TEXT.result.win(side);
}

/** The winner's colour ("B"/"W"), or null for a draw, 無勝負, an unfinished or unknown result. */
export function resultWinner(result) {
  const label=resultLabel(result);
  return label && label!==TEXT.result.draw && label!==TEXT.result.void ? result[0] : null;
}
