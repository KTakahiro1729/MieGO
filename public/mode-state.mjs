import { newGame, SIZE } from "./core.mjs";

export function freshLocalGame(previous, handicap = 0, size = SIZE, rules = "chinese") {
  return newGame(previous?.assisted !== false, { handicap, size, rules });
}

export function gameStorageKey(mode) {
  if(mode==="local")return "miego-game-local";
  if(mode==="ai")return "miego-game-ai";
  throw new Error("Unknown offline game mode");
}
export function parseGameSnapshot(raw) {
  if(!raw)return null;
  try {
    const value=JSON.parse(raw);
    return value && Array.isArray(value.board) && [81,169,361].includes(value.board.length) &&
      value.board.every(x=>x===-1||x===0||x===1) &&
      Array.isArray(value.moves) && Number.isSafeInteger(value.moveNumber) &&
      value.moveNumber>=0 && (value.next===1||value.next===-1) ? value : null;
  }catch{return null;}
}
export function needsSwitchConfirmation(game,from,to,connected=false) {
  if(from===to)return false;
  return !!connected || !!game?.moveNumber;
}
