export function gameStorageKey(mode) {
  if(mode==="local")return "miego-game-local";
  if(mode==="ai")return "miego-game-ai";
  throw new Error("Unknown offline game mode");
}
export function parseGameSnapshot(raw) {
  if(!raw)return null;
  try {
    const value=JSON.parse(raw);
    return value && Array.isArray(value.board) && value.board.length===81 &&
      value.board.every(x=>x===-1||x===0||x===1) &&
      Array.isArray(value.moves) && Number.isSafeInteger(value.moveNumber) &&
      value.moveNumber>=0 && (value.next===1||value.next===-1) ? value : null;
  }catch{return null;}
}
export function needsSwitchConfirmation(game,from,to,connected=false) {
  if(from===to)return false;
  return !!connected || !!game?.moveNumber;
}
