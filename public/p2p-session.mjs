import {
  areaScore,
  BLACK,
  boardHash,
  handicapOf,
  isFree,
  komiOf,
  rulesOf,
  scoreResult,
  WHITE,
} from "./core.mjs";
import { parseGameSnapshot } from "./mode-state.mjs";
import { replaySteps } from "./sgf.mjs";
import { TEXT } from "./texts.mjs";

export const ROOM_PATTERN = /^[a-f0-9]{32}$/;
export const TOKEN_PATTERN = /^[a-f0-9]{48}$/;
export const storageKey = room => "miego-online-v2-" + room;
export const playerColor = (role, ownerColor) =>
  role === "owner" ? ownerColor : ownerColor === BLACK ? WHITE : BLACK;
export const colorLabel = color => color === BLACK ? TEXT.online.colorBlack : TEXT.online.colorWhite;
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
/** The address bar shows only the room; seat keys stay in this browser's storage. */
export function roomUrl(origin, room) {
  if (!ROOM_PATTERN.test(room)) throw Error("Invalid invitation");
  return new URL("/?room=" + room, origin).href;
}
/** The seat whose sign-ins on another device this player should hear about. */
export function newPeerSignins(signins, role, seen) {
  const count = signins?.[role === "owner" ? "guest" : "owner"];
  if (!Number.isInteger(count) || count < 0) return {seen, notify:false};
  return {seen:count, notify:Number.isInteger(seen) && count > seen};
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
// Actions a peer may only take in its own name, those only the room owner sends,
// and those of games without a friend.
const OWN_COLOR_ACTIONS=new Set(["agree","agree_dead","end_offer","end_answer","takeback_request","takeback_answer"]);
const OWNER_ACTIONS=new Set(["dead_auto","dead_unavailable"]);
const SOLO_ACTIONS=new Set(["solo_scoring","solo_score","solo_dead"]);
/** A peer plays only on its own turn and offers, answers or agrees only for its own color.
 * On a free board either player places either colour, or takes a stone off, at any time. */
export function isPeerAction(action, game, {peerColor, peerIsOwner=false}) {
  if(![BLACK,WHITE].includes(peerColor))return false;
  if(action?.type==="move")return isFree(game)?[BLACK,WHITE].includes(action.color):game.next===peerColor;
  if(OWN_COLOR_ACTIONS.has(action?.type))return action.color===peerColor;
  if(OWNER_ACTIONS.has(action?.type))return peerIsOwner===true;
  return !SOLO_ACTIONS.has(action?.type);
}
const isColor=value=>value===BLACK||value===WHITE;
const isOffer=offer=>offer==null || (typeof offer==="object" && isColor(offer.from));
/** A received snapshot must be the position its own move list produces under
 * MieGO's rules; a finished count must be agreed by both and match the board. */
export function isConsistentSnapshot(game) {
  let replayed;
  try{replayed=replaySteps(game);}catch{return false;}
  if(boardHash(replayed.board)!==boardHash(game.board) || replayed.next!==game.next ||
     replayed.moveNumber!==game.moveNumber || komiOf(replayed)!==komiOf(game) ||
     JSON.stringify(replayed.history)!==JSON.stringify(game.history) ||
     JSON.stringify(replayed.captures)!==JSON.stringify(game.captures))return false;
  if(!game.agreed || typeof game.agreed.black!=="boolean" || typeof game.agreed.white!=="boolean" ||
     !Array.isArray(game.dead) || !isOffer(game.endProposal) || !isOffer(game.takebackRequest))
    return false;
  if(replayed.status==="finished")return game.status==="finished" && game.result===replayed.result;
  if(game.status==="playing")return true;
  if(!game.dead.every(p=>Number.isInteger(p) && p>=0 && p<game.board.length && game.board[p]!==0))
    return false;
  if(game.status==="scoring")return true;
  if(game.status!=="finished" || !game.agreed.black || !game.agreed.white)return false;
  return game.result===scoreResult(areaScore(game));
}
function commonPrefix(a,b) {
  let i=0;
  while(i<a.length && i<b.length && JSON.stringify(a[i])===JSON.stringify(b[i]))i++;
  return i;
}
/** Only this device plays its own stones and agrees to its own count. A device
 * that has synced before rejects a snapshot that claims it did either elsewhere. */
function claimsLocalPlayer(localGame, incoming, localColor) {
  if(!isColor(localColor))return false;
  // Both players place both colours on a free board, and nobody agrees to a count.
  if(isFree(incoming))return false;
  const added=incoming.moves.slice(commonPrefix(localGame.moves,incoming.moves));
  if(added.some(move=>move?.color===localColor))return true;
  const key=localColor===BLACK?"black":"white";
  return incoming.agreed?.[key]===true && localGame.agreed?.[key]!==true;
}
function sameMoves(a,b) {
  if (!Array.isArray(a?.moves) || !Array.isArray(b?.moves)) return false;
  const shorter = a.moves.length <= b.moves.length ? a : b;
  const longer = shorter === a ? b : a;
  return shorter.moves.every((move,i) => JSON.stringify(move) === JSON.stringify(longer.moves[i]));
}
export function reconcileGame(localGame, localRevision, incomingGame, incomingRevision, {localIsOwner=false,localColor=null}={}) {
  if (!Number.isInteger(incomingRevision) || incomingRevision < 0 ||
      !Number.isInteger(localRevision) || localRevision < 0)
    return {kind:"invalid"};
  const incoming = parseGameSnapshot(JSON.stringify(incomingGame));
  if (!incoming || !isConsistentSnapshot(incoming)) return {kind:"conflict"};
  if (localRevision > 0 && incomingRevision > localRevision &&
      claimsLocalPlayer(localGame, incoming, localColor)) return {kind:"conflict"};
  // A guest that has not received the match yet holds a default empty board;
  // before the first move the inviter's board size, handicap, rules, 石を隠す and 禁じ手 decide the game.
  if (localRevision === 0 && incomingRevision === 0 && !localGame.moves.length &&
      !incoming.moves.length && (localGame.board.length !== incoming.board.length ||
      handicapOf(localGame) !== handicapOf(incoming) || rulesOf(localGame) !== rulesOf(incoming) ||
      (localGame.hideStones === true) !== (incoming.hideStones === true) ||
      (localGame.gomokuForbidden === true) !== (incoming.gomokuForbidden === true)))
    return localIsOwner ? {kind:"send"} : {kind:"adopt",game:incoming,revision:0};
  // An accepted 待った shortens the move list. The side that applied more
  // takebacks and has the newer revision holds the agreed line.
  const localTakebacks = localGame.takebacks || 0, incomingTakebacks = incoming.takebacks || 0;
  if (incomingTakebacks > localTakebacks && incomingRevision > localRevision)
    return {kind:"adopt",game:incoming,revision:incomingRevision};
  if (localTakebacks > incomingTakebacks && localRevision > incomingRevision) return {kind:"send"};
  // Two edits made at the same moment on a free board: the inviter's board stands.
  if (!sameMoves(localGame,incoming) && isFree(localGame) && isFree(incoming))
    return localIsOwner ? {kind:"send"} :
      {kind:"adopt",game:incoming,revision:Math.max(localRevision,incomingRevision)};
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
