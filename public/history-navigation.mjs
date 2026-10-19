/** Presentation fields and navigation rules for saved SGF/game records. */
export function recordName(record) {
  if(record.source==="variation")return "保存した変化図";
  if(record.source==="sgf")return "SGFから読み込んだ棋譜";
  return record.mode==="ai"?"AIと対戦":record.mode==="online"?"友人と対戦":"1台で打つ";
}

export function recordStatus(record) {
  if(record.source==="variation")return "変化図";
  if(record.source==="sgf")return "読み込み済み";
  return record.snapshot.status==="finished"?"終局済み":
    record.snapshot.status==="scoring"?"採点中":"対局中";
}

export function dateLabel(timestamp) {
  const date=new Date(timestamp);
  return Number.isNaN(date.getTime())?"日時不明":
    date.toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
}

export function recordIcon(record) {
  return record.source==="variation"?"↪":record.source==="sgf"?"SGF":record.mode==="online"?"↗":record.mode==="ai"?"AI":"●";
}

export function recordSummary(record,includeKomi=false) {
  const summary=recordStatus(record)+" · "+record.snapshot.moveNumber+"手 · "+dateLabel(record.updatedAt);
  return summary+(includeKomi && record.sgfMeta?" · コミ "+record.sgfMeta.komi:"");
}

export function readOnlyHint(record) {
  if(record.source==="variation")return "元の棋譜とは独立して保存した検討用の変化図です。";
  if(record.source==="sgf")return "SGFの主変化のみを読み込みました。置き石・9路盤以外には未対応。検討はMieGOの中国式・コミ7.5で新しい対局として始まります。";
  if(record.mode==="online")return "友人対局は閲覧専用です。途中局面の検討は別の1台対局として開始します。";
  if(record.snapshot.status==="finished")return "終局した棋譜です。途中局面から新しい1台対局を始められます。";
  return "最後の局面から元の対局を再開するか、別の1台対局として検討できます。";
}

/** The UI clamps slider/keyboard input; archive viewing never edits the saved match. */
export function navigationState(record,requestedStep) {
  const count=record.snapshot.moves.length;
  const raw=Number(requestedStep);
  const step=Number.isFinite(raw)?Math.max(0,Math.min(count,Math.trunc(raw))):count;
  return {
    count,step,
    firstDisabled:step===0,
    lastDisabled:step===count,
    resumable:record.mode!=="online" && !["sgf","variation"].includes(record.source) &&
      record.snapshot.status!=="finished" && step===count
  };
}
