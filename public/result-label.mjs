// One wording for game results everywhere (score box, history, shared card).
// Written so a beginner can read it without Go jargon (no 中押し or 目半):
// who won, and by what — points as a decimal, or the loser's resignation.
const COLOR = {B:"黒",W:"白"};
const OTHER = {B:"W",W:"B"};

/** Japanese wording for an SGF-style result such as "B+3.5" or "W+R"; null if unknown. */
export function resultLabel(result) {
  if(typeof result!=="string" || !result)return null;
  if(/^(0|Draw|Jigo)$/i.test(result))return "引き分け";
  const match=/^([BW])\+(.*)$/.exec(result);
  if(!match)return null;
  const [,side,detail]=match;
  if(/^R(esign)?$/i.test(detail))return COLOR[OTHER[side]]+"の投了で"+COLOR[side]+"が勝利";
  if(/^T(ime)?$/i.test(detail))return COLOR[OTHER[side]]+"の時間切れで"+COLOR[side]+"が勝利";
  if(/^\d+(\.\d+)?$/.test(detail))return COLOR[side]+"が"+Number(detail).toFixed(1)+"目差で勝利";
  return COLOR[side]+"が勝利";
}

/** The winner's colour ("B"/"W"), or null for a draw, an unfinished or unknown result. */
export function resultWinner(result) {
  const label=resultLabel(result);
  return label && label!=="引き分け" ? result[0] : null;
}
