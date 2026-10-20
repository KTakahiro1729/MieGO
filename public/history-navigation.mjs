import { resultLabel } from "./result-label.mjs";
import { TEXT } from "./texts.mjs";

/** Presentation fields and navigation rules for saved SGF/game records. */
export function recordName(record) {
  if(record.source==="variation")return TEXT.history.titleVariation;
  if(record.source==="sgf")return TEXT.history.titleSgf;
  return record.mode==="ai"?TEXT.common.modeAi:record.mode==="online"?TEXT.common.modeOnline:TEXT.common.modeLocal;
}

export function recordStatus(record) {
  if(record.source==="variation")return TEXT.history.statusVariation;
  if(record.source==="sgf")return TEXT.history.statusSgf;
  return record.snapshot.status==="finished"?resultLabel(record.snapshot.result)||TEXT.history.statusFinished:
    record.snapshot.status==="scoring"?TEXT.common.scoring:TEXT.common.playing;
}

export function dateLabel(timestamp) {
  const date=new Date(timestamp);
  return Number.isNaN(date.getTime())?TEXT.history.unknownDate:
    date.toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
}

export function recordIcon(record) {
  return record.source==="variation"?"↪":record.source==="sgf"?"SGF":record.mode==="online"?"↗":record.mode==="ai"?"COM":"●";
}

export function recordSummary(record,includeKomi=false) {
  const summary=TEXT.history.summary(recordStatus(record),record.snapshot.moveNumber,dateLabel(record.updatedAt));
  return summary+(includeKomi && record.sgfMeta?TEXT.history.komi(record.sgfMeta.komi):"");
}

// A game nobody has played into yet (the one saved on first visit) says nothing in the list.
export function isBlankRecord(record) {
  return !["sgf","variation"].includes(record.source) && record.snapshot.status==="playing" &&
    record.snapshot.moves.length===0;
}

export function readOnlyHint(record) {
  if(record.source==="variation")return TEXT.history.noteVariation;
  if(record.source==="sgf")return TEXT.history.noteSgf;
  if(record.mode==="online")return TEXT.history.noteOnline;
  if(record.snapshot.status==="finished")return TEXT.history.noteFinished;
  return TEXT.history.noteOngoing;
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
