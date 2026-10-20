import { TEXT } from "./texts.mjs";
/** The default (and historical) board size; positions carry their own size. */
export const SIZE = 9;
export const BOARD_SIZES = Object.freeze([9, 13, 19]);
export const KOMI = 7.5;
export const BLACK = 1;
export const WHITE = -1;
export const isBoardSize = size => BOARD_SIZES.includes(size);
/** A flat board's side length, derived from its length (unknown shapes fall back to 9). */
export const sizeOf = board => {
  const size = Math.round(Math.sqrt(board?.length || 0));
  return isBoardSize(size) && size * size === board.length ? size : SIZE;
};
export const at = (x, y, size = SIZE) => y * size + x;
export const xy = (n, size = SIZE) => [n % size, Math.floor(n / size)];
export function neighbors(n, size = SIZE) {
  const [x, y] = xy(n, size), result = [];
  if (x > 0) result.push(n - 1);
  if (x < size - 1) result.push(n + 1);
  if (y > 0) result.push(n - size);
  if (y < size - 1) result.push(n + size);
  return result;
}
export function group(board, index) {
  const color = board[index], stones = new Set(), liberties = new Set();
  if (!color) return { stones, liberties };
  const size = sizeOf(board);
  const queue = [index]; stones.add(index);
  for (let head = 0; head < queue.length; head++) {
    for (const n of neighbors(queue[head], size)) {
      if (board[n] === 0) liberties.add(n);
      else if (board[n] === color && !stones.has(n)) { stones.add(n); queue.push(n); }
    }
  }
  return { stones, liberties };
}
export const boardHash = board => board.map(n => n + 1).join("");
export const maxHandicap = size => size === 9 ? 5 : 9;
/**
 * Fixed handicap on the star points in the usual order: top-right and
 * bottom-left first, then bottom-right and top-left. Odd counts from five
 * add tengen; six and eight add the side stars instead of it.
 */
export function handicapPoints(size, count) {
  const e = size === 9 ? 2 : 3, f = size - 1 - e, m = (size - 1) / 2;
  const p = (x, y) => at(x, y, size);
  const corners = [p(f, e), p(e, f), p(f, f), p(e, e)];
  const sides = [p(e, m), p(f, m)], ends = [p(m, e), p(m, f)], center = p(m, m);
  if (count <= 4) return corners.slice(0, count);
  const withSides = count >= 6 ? [...corners, ...sides, ...(count >= 8 ? ends : [])] : corners;
  return count % 2 ? [...withSides, center] : withSides;
}
/** Star points drawn on the board: corners and tengen, plus the sides on 19x19. */
export const starPoints = size => handicapPoints(size, size === 19 ? 9 : 5);
// The 9x9 handicap points (kept for callers written before other sizes).
export const HANDICAP_POINTS = Object.freeze(handicapPoints(SIZE, 5));
export const MAX_HANDICAP = maxHandicap(SIZE);
// Handicap games use 0.5 komi; Chinese rules (and KataGo's "chinese" ruleset,
// whiteHandicapBonus=N) also give White one point per handicap stone.
export const HANDICAP_KOMI = 0.5;
export const handicapOf = (state, size = Array.isArray(state?.board) ? sizeOf(state.board) : SIZE) =>
  Number.isInteger(state?.handicap) && state.handicap >= 2 && state.handicap <= maxHandicap(size) ? state.handicap : 0;
export const komiOf = state => Number.isFinite(state?.komi) ? state.komi : KOMI;
/** Points added to White's area: komi plus the Chinese handicap compensation. */
export const whiteCompensation = state => komiOf(state) + handicapOf(state);
// hideStones ("石を隠す") is part of the game: replays, 待った and the
// opponent's copy keep it. It is only written when set, so other games are unchanged.
export function newGame(assisted = true, { handicap = 0, size = SIZE, hideStones = false } = {}) {
  if (!isBoardSize(size)) throw new Error(TEXT.rules.unsupportedSize);
  const stones = handicapOf({ handicap }, size);
  const board = Array(size * size).fill(0);
  for (const p of handicapPoints(size, stones)) board[p] = BLACK;
  return { board, next: stones ? WHITE : BLACK, passes: 0, moves: [], moveNumber: 0,
    captures: { black: 0, white: 0 }, history: [boardHash(board)], status: "playing",
    assisted, handicap: stones, komi: stones ? HANDICAP_KOMI : KOMI,
    dead: [], agreed: { black: false, white: false }, endProposal: null, result: null,
    ...(hideStones ? { hideStones: true } : {}) };
}
/** The empty-or-handicap starting position a record's moves are replayed from. */
export const initialGame = state => newGame(state?.assisted !== false,
  { handicap: handicapOf(state), size: sizeOf(state?.board), hideStones: state?.hideStones === true });
export function play(state, position) {
  if (state.status !== "playing") throw new Error(TEXT.rules.notPlaying);
  // A real move answers any pending 待った request by moving on.
  if (state.takebackRequest) { const { takebackRequest, ...rest } = state; state = rest; }
  const color = state.next;
  if (position === "resign") return {
    ...state, status: "finished", endProposal: null, result: color === BLACK ? "W+R" : "B+R",
    moves: [...state.moves, { color, position: "resign" }]
  };
  if (position === null) {
    const passes = state.passes + 1;
    // Dead marks from an earlier, resumed count never carry into a new one.
    return { ...state, next: -color, passes, endProposal: null, moveNumber: state.moveNumber + 1,
      status: passes >= 2 ? "scoring" : "playing", agreed: { black: false, white: false },
      dead: passes >= 2 ? [] : state.dead,
      history: [...state.history, boardHash(state.board)],
      moves: [...state.moves, { color, position: null }] };
  }
  if (!Number.isInteger(position) || position < 0 || position >= state.board.length || state.board[position]) {
    throw new Error(TEXT.rules.occupied);
  }
  const board = [...state.board]; board[position] = color;
  let captured = 0;
  const seen = new Set();
  for (const n of neighbors(position, sizeOf(board))) {
    if (board[n] !== -color || seen.has(n)) continue;
    const enemy = group(board, n);
    for (const s of enemy.stones) seen.add(s);
    if (enemy.liberties.size === 0) {
      captured += enemy.stones.size;
      for (const s of enemy.stones) board[s] = 0;
    }
  }
  if (group(board, position).liberties.size === 0) throw new Error(TEXT.rules.suicide);
  const hash = boardHash(board);
  if (state.history.length >= 2 && hash === state.history[state.history.length - 2]) {
    throw new Error(TEXT.rules.ko);
  }
  return {
    ...state, board, next: -color, passes: 0, endProposal: null, moveNumber: state.moveNumber + 1,
    history: [...state.history, hash], moves: [...state.moves, { color, position }],
    captures: { black: state.captures.black + (color === BLACK ? captured : 0),
      white: state.captures.white + (color === WHITE ? captured : 0) }
  };
}
/** A proposed conclusion is not a Go move, a pass, or a scoring verdict.
 * Either color may offer, even when it is not their turn. The other side
 * must explicitly accept before entering dead-stone adjudication.
 */
export function proposeEnd(state, color) {
  if (state.status !== "playing" || ![BLACK, WHITE].includes(color)) {
    throw new Error(TEXT.rules.proposeOnlyWhilePlaying);
  }
  // A pending 待った request is settled first; an end offer would be ignored.
  if (state.takebackRequest) return state;
  if (state.endProposal) {
    // Simultaneous proposals are deterministic across the two peers: Black
    // wins the tie, and the other offer is ignored (not a rule preference).
    if (state.endProposal.from === color || color === WHITE) return state;
  }
  return { ...state, endProposal: { from: color, atMove: state.moveNumber } };
}
export function answerEndProposal(state, color, accept) {
  const offer = state.endProposal;
  if (state.status !== "playing" || !offer || ![BLACK, WHITE].includes(color)) {
    throw new Error(TEXT.rules.noEndProposal);
  }
  if (color === offer.from) {
    if (accept) throw new Error(TEXT.rules.ownProposal);
    return { ...state, endProposal: null }; // withdraw own offer
  }
  if (!accept) return { ...state, endProposal: null };
  return { ...state, status: "scoring", passes: 0, endProposal: null,
    dead: [], agreed: { black: false, white: false } };
}
/** A human may open scoring in a solo/AI match, without fabricating
 * another player's (or an AI's) acceptance of an endgame offer.
 */
export function beginSoloScoring(state) {
  if(state.status!=="playing")throw new Error(TEXT.rules.scoreOnlyWhilePlaying);
  return {...state,status:"scoring",passes:0,endProposal:null,dead:[],
    agreed:{black:false,white:false}};
}
export function toggleDead(state, index) {
  if (state.status !== "scoring" || !state.board[index]) throw new Error(TEXT.rules.pickStone);
  const stones = group(state.board, index).stones;
  const dead = new Set(state.dead), removing = [...stones].every(i => dead.has(i));
  for (const i of stones) removing ? dead.delete(i) : dead.add(i);
  return { ...state, dead: [...dead], agreed: { black: false, white: false } };
}
/** Apply a KataGo-based dead-stone proposal as complete connected groups.
 * This is provisional: users may toggle the marked stones before agreement.
 */
export function setDeadCandidates(state, positions) {
  if(state.status!=="scoring" || !Array.isArray(positions)) {
    throw new Error(TEXT.rules.deadOnlyWhileScoring);
  }
  const marked=new Set();
  for(const index of positions) {
    if(!Number.isInteger(index) || index<0 || index>=state.board.length || !state.board[index]) {
      throw new Error(TEXT.rules.badDeadCandidate);
    }
    for(const stone of group(state.board,index).stones) marked.add(stone);
  }
  return {...state,dead:[...marked].sort((a,b)=>a-b),
    agreed:{black:false,white:false}};
}
export function resume(state) {
  if (state.status !== "scoring") throw new Error(TEXT.rules.notCounting);
  return { ...state, status: "playing", passes: 0, endProposal: null, dead: [], agreed: { black: false, white: false } };
}
export function areaScore(state) {
  const board = [...state.board];
  for (const n of state.dead) board[n] = 0;
  const size = sizeOf(board), owned = Array(board.length).fill(0);
  let black = 0, white = whiteCompensation(state);
  for (let i = 0; i < board.length; i++) {
    if (board[i] === BLACK) { black++; owned[i] = BLACK; }
    if (board[i] === WHITE) { white++; owned[i] = WHITE; }
  }
  const visited = new Set();
  for (let i = 0; i < board.length; i++) {
    if (board[i] || visited.has(i)) continue;
    const queue = [i], border = new Set(); visited.add(i);
    for (let head = 0; head < queue.length; head++) {
      for (const n of neighbors(queue[head], size)) {
        if (board[n] && board[n] !== 0) border.add(board[n]);
        if (board[n] === 0 && !visited.has(n)) { visited.add(n); queue.push(n); }
      }
    }
    const owner = border.size === 1 ? [...border][0] : 0;
    for (const n of queue) owned[n] = owner;
    if (owner === BLACK) black += queue.length;
    if (owner === WHITE) white += queue.length;
  }
  return { black, white, difference: black - white, owned };
}
export function agreeScore(state, color) {
  if (state.status !== "scoring" || ![BLACK, WHITE].includes(color)) throw new Error(TEXT.rules.notCounting);
  const agreed = { ...state.agreed, [color === BLACK ? "black" : "white"]: true };
  if (!agreed.black || !agreed.white) return { ...state, agreed };
  const s = areaScore(state);
  return { ...state, agreed, status: "finished",
    result: (s.difference > 0 ? "B+" : "W+") + Math.abs(s.difference).toFixed(1) };
}
/** A single human confirms the provisional score without writing
 * fake agreement by the opposing color into the match record.
 */
export function finalizeSoloScore(state) {
  if(state.status!=="scoring")throw new Error(TEXT.rules.finalizeOnlyWhileScoring);
  const s=areaScore(state);
  return {...state,status:"finished",
    result:(s.difference>0?"B+":"W+")+Math.abs(s.difference).toFixed(1)};
}
export function setAssisted(state, value) {
  if (state.moveNumber !== 0) throw new Error(TEXT.rules.modeLocked);
  return { ...state, assisted: !!value };
}
export function toSGF(state) {
  const enc = c => c === BLACK ? "B" : "W";
  const size = sizeOf(state.board);
  const coord = n => {
    if (n === null) return "";
    const [x, y] = xy(n, size); return String.fromCharCode(97 + x, 97 + y);
  };
  const moves = state.moves.filter(m => m.position !== "resign")
    .map(m => ";" + enc(m.color) + "[" + coord(m.position) + "]").join("");
  const handicap = handicapOf(state);
  return "(;GM[1]FF[4]CA[UTF-8]SZ[" + size + "]KM[" + komiOf(state) + "]RU[Chinese]" +
    (handicap ? "HA[" + handicap + "]AB" + handicapPoints(size, handicap).map(p => "[" + coord(p) + "]").join("") : "") +
    (state.result ? "RE[" + state.result + "]" : "") + moves + ")";
}
