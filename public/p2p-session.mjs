import { BLACK, WHITE, boardHash } from "./core.mjs";
import { parseGameSnapshot } from "./mode-state.mjs";

export const ROOM_PATTERN = /^[a-f0-9]{32}$/;
export const TOKEN_PATTERN = /^[a-f0-9]{48}$/;
export const storageKey = room => "miego-online-v2-" + room;
export const playerColor = (role, ownerColor) =>
  role === "owner" ? ownerColor : ownerColor === BLACK ? WHITE : BLACK;
export const colorLabel = color => color === BLACK ? "黒番" : "白番";
export const selectColor = (choice, cryptoSource = globalThis.crypto) => {
  if (choice === "black") return BLACK;
  if (choice === "white") return WHITE;
  if (choice !== "random") throw Error("Invalid color choice");
  if (!cryptoSource?.getRandomValues) throw Error("Secure randomness unavailable");
  const bytes = cryptoSource.getRandomValues(new Uint8Array(1));
  return bytes[0] < 128 ? BLACK : WHITE;
};
export function guestUrl(origin, room, key) {
  if (!ROOM_PATTERN.test(room) || !TOKEN_PATTERN.test(key)) throw Error("Invalid invitation");
  return new URL("/?room=" + room + "#role=guest&key=" + key, origin).href;
}
export function ownUrl(origin, room, key) {
  if (!ROOM_PATTERN.test(room) || !TOKEN_PATTERN.test(key)) throw Error("Invalid invitation");
  return new URL("/?room=" + room + "#role=owner&key=" + key, origin).href;
}
export function readCheckpoint(storage, room) {
  if (!ROOM_PATTERN.test(room)) return null;
  try {
    const value = JSON.parse(storage.getItem(storageKey(room)) || "null");
    if (!value || !["owner","guest"].includes(value.role)) return null;
    const game = parseGameSnapshot(JSON.stringify(value.game));
    if (!game) return null;
    if (!Number.isInteger(value.revision) || value.revision < 0) return null;
    return { ...value, game, lastPosition: value.lastPosition ?? null };
  } catch {return null;}
}
export function saveCheckpoint(storage, room, value) {
  if (!ROOM_PATTERN.test(room) || !value || !["owner","guest"].includes(value.role)) return false;
  try { storage.setItem(storageKey(room), JSON.stringify(value)); return true; }
  catch {return false;}
}
function sameMoves(a,b) {
  if (!Array.isArray(a?.moves) || !Array.isArray(b?.moves)) return false;
  const shorter = a.moves.length <= b.moves.length ? a : b;
  const longer = shorter === a ? b : a;
  return shorter.moves.every((move,i) => JSON.stringify(move) === JSON.stringify(longer.moves[i]));
}
export function reconcileGame(localGame, localRevision, incomingGame, incomingRevision, {localIsOwner=false}={}) {
  if (!Number.isInteger(incomingRevision) || incomingRevision < 0 ||
      !Number.isInteger(localRevision) || localRevision < 0)
    return {kind:"invalid"};
  const incoming = parseGameSnapshot(JSON.stringify(incomingGame));
  if (!incoming) return {kind:"conflict"};
  // A guest that has not received the match yet holds a default empty board;
  // before the first move the inviter's board size decides the game.
  if (localRevision === 0 && incomingRevision === 0 && !localGame.moves.length &&
      !incoming.moves.length && localGame.board.length !== incoming.board.length)
    return localIsOwner ? {kind:"send"} : {kind:"adopt",game:incoming,revision:0};
  // An accepted 待った shortens the move list. The side that applied more
  // takebacks and has the newer revision holds the agreed line.
  const localTakebacks = localGame.takebacks || 0, incomingTakebacks = incoming.takebacks || 0;
  if (incomingTakebacks > localTakebacks && incomingRevision > localRevision)
    return {kind:"adopt",game:incoming,revision:incomingRevision};
  if (localTakebacks > incomingTakebacks && localRevision > incomingRevision) return {kind:"send"};
  if (!sameMoves(localGame,incoming)) return {kind:"conflict"};
  // Local validation rejects inconsistent board data even when move lists match.
  if (localGame.moves.length === incoming.moves.length &&
      boardHash(localGame.board) !== boardHash(incoming.board)) return {kind:"conflict"};
  const localHash = JSON.stringify(localGame);
  const incomingHash = JSON.stringify(incoming);
  if (incomingRevision === localRevision) return {kind:localHash===incomingHash?"equal":"conflict"};
  if (incomingRevision < localRevision) return {kind:"send"};
  if (incoming.moves.length < localGame.moves.length) return {kind:"conflict"};
  return {kind:"adopt",game:incoming,revision:incomingRevision};
}
