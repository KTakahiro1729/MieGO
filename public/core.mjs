import { TEXT } from "./texts.mjs";
import { UserError } from "./user-error.mjs";
import { forbiddenReason, makesFive } from "./gomoku.mjs";
import { timeControlOf } from "./game-clock.mjs";
// Occupied points, suicide and ko are the rule messages players read (illegal
// previews, SGF import). The other errors mean a caller or a peer acted out of
// turn; the UI never offers those actions, so their messages are for developers.
/** The default (and historical) board size; positions carry their own size. */
export const SIZE = 9;
export const BOARD_SIZES = Object.freeze([9, 13, 19]);
export const KOMI = 7.5;
/**
 * Chinese area scoring (the default), Japanese territory scoring, or 五目並べ
 * (free-style gomoku, gomoku.mjs) played with the same stones on the same board.
 */
export const RULESETS = Object.freeze(["chinese", "japanese", "gomoku", "free"]);
// Even-game komi per ruleset (KataGo's defaults; the Nihon Ki-in uses 6.5).
export const RULES_KOMI = Object.freeze({ chinese: 7.5, japanese: 6.5, gomoku: 0, free: 0 });
export const rulesOf = state => RULESETS.includes(state?.rules) ? state.rules : "chinese";
export const isJapanese = state => rulesOf(state) === "japanese";
export const isGomoku = state => rulesOf(state) === "gomoku";
// 自由に置く: a board without rules for setting up and studying positions.
export const isFree = state => rulesOf(state) === "free";
/** 五目並べ with renju's forbidden moves for Black (三三・四四・長連). */
export const hasGomokuForbidden = state => isGomoku(state) && state?.gomokuForbidden === true;
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
// Handicap games use 0.5 komi; Chinese rules (and KataGo's "chinese" ruleset,
// whiteHandicapBonus=N) also give White one point per handicap stone. Japanese
// territory scoring needs no such bonus (KataGo: whiteHandicapBonus=0), since
// the handicap stones themselves are not counted.
export const HANDICAP_KOMI = 0.5;
export const handicapOf = (state, size = Array.isArray(state?.board) ? sizeOf(state.board) : SIZE) =>
  Number.isInteger(state?.handicap) && state.handicap >= 2 && state.handicap <= maxHandicap(size) ? state.handicap : 0;
export const komiOf = state => Number.isFinite(state?.komi) ? state.komi : RULES_KOMI[rulesOf(state)];
/** Chinese handicap compensation: one point per stone, none under Japanese rules. */
export const handicapBonusOf = state => isJapanese(state) ? 0 : handicapOf(state);
/** Points added to White's score: komi plus any handicap compensation. */
export const whiteCompensation = state => komiOf(state) + handicapBonusOf(state);
// hideStones ("石を隠す") is part of the game: replays, 待った and the
// opponent's copy keep it. It is only written when set, so other games are unchanged.
// 五目並べ has no handicap stones. Its 禁じ手 choice, like hideStones, is
// only written when set, so other games keep their shape. So is the 持ち時間
// (timeControl, game-clock.mjs); each side's time left goes in state.clock.
export function newGame(assisted = true, { gomokuForbidden = false, handicap = 0, size = SIZE, rules = "chinese", hideStones = false, timeControl = null } = {}) {
  const gomoku = rulesOf({ rules }) === "gomoku", free = rulesOf({ rules }) === "free";
  // A free board takes no handicap, and its stones are what it is for, so they are never hidden.
  if (gomoku || free) handicap = 0;
  if (free) hideStones = false;
  // Nobody takes turns on a free board, so it has no clock.
  const clock = free ? null : timeControlOf(timeControl);
  const stones = handicapOf({ handicap }, size);
  const board = Array(size * size).fill(0);
  for (const p of handicapPoints(size, stones)) board[p] = BLACK;
  return { board, next: stones ? WHITE : BLACK, passes: 0, moves: [], moveNumber: 0,
    captures: { black: 0, white: 0 }, history: [boardHash(board)], status: "playing",
    assisted, handicap: stones, rules: rulesOf({ rules }),
    komi: stones ? HANDICAP_KOMI : RULES_KOMI[rulesOf({ rules })],
    dead: [], agreed: { black: false, white: false }, endProposal: null, result: null,
    ...(hideStones ? { hideStones: true } : {}),
    ...(gomoku && gomokuForbidden ? { gomokuForbidden: true } : {}),
    ...(clock ? { timeControl: clock } : {}) };
}
/** The empty-or-handicap starting position a record's moves are replayed from. */
export const initialGame = state => newGame(state?.assisted !== false,
  { handicap: handicapOf(state), size: sizeOf(state?.board), rules: rulesOf(state),
    hideStones: state?.hideStones === true, gomokuForbidden: hasGomokuForbidden(state),
    timeControl: state?.timeControl ?? null });
/** `color` ran out of time: the game ends there, like a resignation but with no move. */
export function loseOnTime(state, color) {
  if (state.status !== "playing") return state;
  return { ...state, status: "finished", endProposal: null, result: color === BLACK ? "W+T" : "B+T" };
}
export function play(state, position) {
  if (state.status !== "playing") throw new Error("Not playing");
  // A real move answers any pending 待った request by moving on.
  if (state.takebackRequest) { const { takebackRequest, ...rest } = state; state = rest; }
  const color = state.next;
  if (isFree(state)) return playFree(state, position, color);
  if (position === "resign") return {
    ...state, status: "finished", endProposal: null, result: color === BLACK ? "W+R" : "B+R",
    moves: [...state.moves, { color, position: "resign" }]
  };
  if (isGomoku(state)) return playGomoku(state, position, color);
  if (position === null) {
    const passes = state.passes + 1;
    // Dead marks from an earlier, resumed count never carry into a new one.
    return { ...state, next: -color, passes, endProposal: null, moveNumber: state.moveNumber + 1,
      status: passes >= 2 ? "scoring" : "playing", agreed: { black: false, white: false },
      ...(passes >= 2 ? { scoringStep: "dead" } : {}),
      dead: passes >= 2 ? [] : state.dead,
      history: [...state.history, boardHash(state.board)],
      moves: [...state.moves, { color, position: null }] };
  }
  if (!Number.isInteger(position) || position < 0 || position >= state.board.length || state.board[position]) {
    throw new UserError(TEXT.rules.occupied);
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
  if (group(board, position).liberties.size === 0) throw new UserError(TEXT.rules.suicide);
  const hash = boardHash(board);
  if (state.history.length >= 2 && hash === state.history[state.history.length - 2]) {
    throw new UserError(TEXT.rules.ko);
  }
  return {
    ...state, board, next: -color, passes: 0, endProposal: null, moveNumber: state.moveNumber + 1,
    history: [...state.history, hash], moves: [...state.moves, { color, position }],
    captures: { black: state.captures.black + (color === BLACK ? captured : 0),
      white: state.captures.white + (color === WHITE ? captured : 0) }
  };
}
/** 五目並べ: no pass, capture, suicide or ko; five in a row ends the game. */
function playGomoku(state, position, color) {
  if (position === null) throw new Error("No pass in gomoku");
  if (!Number.isInteger(position) || position < 0 || position >= state.board.length || state.board[position]) {
    throw new UserError(TEXT.rules.occupied);
  }
  const renju = hasGomokuForbidden(state) && color === BLACK;
  const forbidden = renju ? forbiddenReason(state.board, position) : null;
  if (forbidden) throw new UserError(TEXT.rules.gomoku[forbidden]);
  const board = [...state.board]; board[position] = color;
  // Under 禁じ手 Black wins only with exactly five; White and free-style with five or more.
  const won = makesFive(board, position, renju), full = !board.includes(0);
  return {
    ...state, board, next: -color, passes: 0, endProposal: null, moveNumber: state.moveNumber + 1,
    history: [...state.history, boardHash(board)], moves: [...state.moves, { color, position }],
    ...(won || full ? { status: "finished", result: won ? (color === BLACK ? "B+" : "W+") : "0" } : {})
  };
}
/** 自由に置く: an empty point takes a stone of colour state.next, a stone is
 * taken off. Nothing is captured. The colour to place is chosen by each player
 * outside the game (playFreeStone), so next only follows the latest edit. */
function playFree(state, position, color) {
  if (!Number.isInteger(position) || position < 0 || position >= state.board.length ||
      ![BLACK, WHITE].includes(color)) throw new Error("Only stones on points on a free board");
  const board = [...state.board]; board[position] = board[position] ? 0 : color;
  return {
    ...state, board, passes: 0, moveNumber: state.moveNumber + 1,
    history: [...state.history, boardHash(board)], moves: [...state.moves, { color, position }]
  };
}
/** Places or takes off a stone on a free board in the colour the player chose. */
export const playFreeStone = (state, position, color) => play({ ...state, next: color }, position);
/** Replays one recorded move. On a free board the move's colour is chosen, not alternated. */
export const replayMove = (state, { color, position }) =>
  play(isFree(state) ? { ...state, next: color } : state, position);
/** A proposed conclusion is not a Go move, a pass, or a scoring verdict.
 * Either color may offer, even when it is not their turn. The other side
 * must explicitly accept before entering dead-stone adjudication.
 */
export function proposeEnd(state, color) {
  if (state.status !== "playing" || ![BLACK, WHITE].includes(color)) {
    throw new Error("No end offer outside play");
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
    throw new Error("No end offer to answer");
  }
  if (color === offer.from) {
    if (accept) throw new Error("Cannot accept own end offer");
    return { ...state, endProposal: null }; // withdraw own offer
  }
  if (!accept) return { ...state, endProposal: null };
  return { ...state, status: "scoring", scoringStep: "dead", passes: 0, endProposal: null,
    dead: [], agreed: { black: false, white: false } };
}
/** A human may open scoring in a solo/AI match, without fabricating
 * another player's (or an AI's) acceptance of an endgame offer.
 */
export function beginSoloScoring(state) {
  return {...state,status:"scoring",scoringStep:"dead",passes:0,endProposal:null,dead:[],
    agreed:{black:false,white:false}};
}
export function toggleDead(state, index) {
  const stones = group(state.board, index).stones;
  const dead = new Set(state.dead), removing = [...stones].every(i => dead.has(i));
  for (const i of stones) removing ? dead.delete(i) : dead.add(i);
  // Changing the dead stones goes back to the dead-stone step.
  return { ...state, dead: [...dead], scoringStep: "dead", agreed: { black: false, white: false } };
}
/** Apply a KataGo-based dead-stone proposal as complete connected groups.
 * This is provisional: users may toggle the marked stones before agreement.
 */
export function setDeadCandidates(state, positions) {
  if(state.status!=="scoring" || !Array.isArray(positions)) {
    throw new Error("Not scoring");
  }
  const marked=new Set();
  for(const index of positions) {
    if(!Number.isInteger(index) || index<0 || index>=state.board.length || !state.board[index]) {
      throw new Error("Invalid dead-stone candidate");
    }
    for(const stone of group(state.board,index).stones) marked.add(stone);
  }
  return {...state,dead:[...marked].sort((a,b)=>a-b),scoringStep:"dead",
    agreed:{black:false,white:false}};
}
export function resume(state) {
  if (state.status !== "scoring") throw new Error("Not scoring");
  // The playout's fill stones belong to this count only.
  const { fill, ...rest } = state;
  return { ...rest, status: "playing", scoringStep: "dead", passes: 0, endProposal: null, dead: [],
    agreed: { black: false, white: false } };
}
/**
 * 決着手順の石: the stones KataGo's settle playout placed on points that are
 * empty in the match. They stay as fill stones for the count, so the borders
 * the players left open are closed the way the playout closed them; the
 * match's own moves never change.
 */
export function withPlayoutFill(state, settledBoard) {
  const { fill: _, ...rest } = state;
  if (!Array.isArray(settledBoard) || settledBoard.length !== state.board.length) return rest;
  const fill = settledBoard.map((c, i) => !state.board[i] && (c === BLACK || c === WHITE) ? c : 0);
  return fill.some(Boolean) ? { ...rest, fill } : rest;
}
/**
 * The fill stones the count keeps: those on a border. A fill stone that
 * touches only its own colour and its own territory merely filled territory
 * (to capture dead stones), so it counts as the territory it stands on.
 */
export function fillStones(state) {
  const fill = state?.fill;
  if (!Array.isArray(fill) || fill.length !== state.board.length) return [];
  const dead = new Set(state.dead);
  const isFill = i => !state.board[i] && (fill[i] === BLACK || fill[i] === WHITE);
  const board = state.board.map((stone, i) => dead.has(i) ? 0 : isFill(i) ? fill[i] : stone);
  const owner = Array(board.length).fill(0), size = sizeOf(board), kept = [];
  for (const region of emptyRegions(board)) for (const p of region.points) owner[p] = region.owner;
  for (let i = 0; i < board.length; i++) {
    if (!isFill(i)) continue;
    const color = fill[i];
    if (!neighbors(i, size).every(n => board[n] === color || !board[n] && owner[n] === color))
      kept.push({ position: i, color });
  }
  return kept;
}
/** The board the count is made on: dead stones off, the kept fill stones on. */
export function countingBoard(state) {
  const dead = new Set(state.dead), board = state.board.map((stone, i) => dead.has(i) ? 0 : stone);
  for (const { position, color } of fillStones(state)) board[position] = color;
  return board;
}
/** The final score under the game's ruleset (area or territory). */
export function areaScore(state) {
  return isJapanese(state) ? territoryScore(state) : chineseAreaScore(state);
}
function chineseAreaScore(state) {
  const board = countingBoard(state), owned = Array(board.length).fill(0);
  let black = 0, white = whiteCompensation(state);
  for (let i = 0; i < board.length; i++) {
    if (board[i] === BLACK) { black++; owned[i] = BLACK; }
    if (board[i] === WHITE) { white++; owned[i] = WHITE; }
  }
  for (const { points, owner } of emptyRegions(board)) {
    for (const n of points) owned[n] = owner;
    if (owner === BLACK) black += points.length;
    if (owner === WHITE) white += points.length;
  }
  return { black, white, difference: black - white, owned };
}
/** Empty regions (after removing dead stones) with the colour that alone borders each. */
function emptyRegions(board) {
  const size = sizeOf(board), visited = new Set(), regions = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] || visited.has(i)) continue;
    const points = [i], border = new Set(); visited.add(i);
    for (let head = 0; head < points.length; head++) {
      for (const n of neighbors(points[head], size)) {
        if (board[n]) border.add(board[n]);
        else if (!visited.has(n)) { visited.add(n); points.push(n); }
      }
    }
    regions.push({ points, owner: border.size === 1 ? [...border][0] : 0 });
  }
  return regions;
}
/** Liberties of the group a stone of `color` at empty `point` would join. */
function libertiesAfter(board, point, color) {
  const next = [...board]; next[point] = color;
  return group(next, point).liberties.size;
}
/**
 * Stones in seki, found from the shared liberties left at the end: an empty
 * point touching both colours where a stone of either colour would leave its
 * own group in atari (or with no liberty), so neither side can fill it.
 */
export function sekiStones(state) {
  const board = countingBoard(state);
  const size = sizeOf(board), seki = new Set();
  for (let p = 0; p < board.length; p++) {
    if (board[p]) continue;
    const touching = neighbors(p, size).filter(n => board[n]);
    if (!touching.some(n => board[n] === BLACK) || !touching.some(n => board[n] === WHITE)) continue;
    // Filling must not capture anything: then it would be a real move, not seki.
    const captures = color => touching.some(n => board[n] === -color && group(board, n).liberties.size === 1);
    if (captures(BLACK) || captures(WHITE)) continue;
    if (libertiesAfter(board, p, BLACK) > 1 || libertiesAfter(board, p, WHITE) > 1) continue;
    for (const n of touching) for (const s of group(board, n).stones) seki.add(s);
  }
  return [...seki].sort((a, b) => a - b);
}
/**
 * Japanese territory scoring (Nihon Ki-in rules, 1989): territory plus
 * prisoners. Prisoners are the stones captured during play and the dead
 * stones removed at the end. Empty points enclosed by stones in seki are not
 * territory, and stones on the board do not count.
 */
export function territoryScore(state) {
  const dead = new Set(state.dead);
  const board = countingBoard(state);
  const seki = new Set(sekiStones(state)), size = sizeOf(board);
  const owned = board.map(stone => stone);
  const territory = { black: 0, white: 0 };
  for (const { points, owner } of emptyRegions(board)) {
    const inSeki = owner && points.some(p => neighbors(p, size).some(n => seki.has(n)));
    const color = inSeki ? 0 : owner;
    for (const p of points) owned[p] = color;
    if (color === BLACK) territory.black += points.length;
    if (color === WHITE) territory.white += points.length;
  }
  let deadBlack = 0, deadWhite = 0;
  for (const i of dead) { if (state.board[i] === BLACK) deadBlack++; if (state.board[i] === WHITE) deadWhite++; }
  const prisoners = { black: (state.captures?.black || 0) + deadWhite,
    white: (state.captures?.white || 0) + deadBlack };
  const black = territory.black + prisoners.black;
  const white = territory.white + prisoners.white + whiteCompensation(state);
  return { black, white, difference: black - white, owned, territory, prisoners, seki: [...seki] };
}
/**
 * Japanese counting has two steps: both sides first agree on the dead stones
 * ("dead"); then the prisoners are filled into territory and they agree on
 * the count ("count"). Chinese counting is a single step (null).
 */
export const scoringStepOf = state => state?.status === "scoring" && isJapanese(state)
  ? (state.scoringStep === "count" ? "count" : "dead") : null;
export function agreeDead(state, color) {
  if (scoringStepOf(state) !== "dead" || ![BLACK, WHITE].includes(color)) throw new Error("Not scoring");
  const agreed = { ...state.agreed, [color === BLACK ? "black" : "white"]: true };
  if (!agreed.black || !agreed.white) return { ...state, agreed };
  return { ...state, scoringStep: "count", agreed: { black: false, white: false } };
}
/** A single human confirms the dead stones, as finalizeSoloScore does the count. */
export function confirmDeadSolo(state) {
  if (scoringStepOf(state) !== "dead") throw new Error("Not scoring");
  return { ...state, scoringStep: "count", agreed: { black: false, white: false } };
}
/** Back from the count to the dead stones. */
export function backToDead(state) {
  if (scoringStepOf(state) !== "count") throw new Error("Not scoring");
  return { ...state, scoringStep: "dead", agreed: { black: false, white: false } };
}
export function agreeScore(state, color) {
  if (state.status !== "scoring" || scoringStepOf(state) === "dead" || ![BLACK, WHITE].includes(color))
    throw new Error("Not scoring");
  const agreed = { ...state.agreed, [color === BLACK ? "black" : "white"]: true };
  if (!agreed.black || !agreed.white) return { ...state, agreed };
  return { ...state, agreed, status: "finished", result: scoreResult(areaScore(state)) };
}
/** A single human confirms the provisional score without writing
 * fake agreement by the opposing color into the match record.
 */
export function finalizeSoloScore(state) {
  if(scoringStepOf(state)==="dead")throw new Error("Dead stones not agreed");
  return {...state,status:"finished",result:scoreResult(areaScore(state))};
}
/** The SGF result of a count, such as "B+3.5". */
export function scoreResult(score) {
  return (score.difference > 0 ? "B+" : "W+") + Math.abs(score.difference).toFixed(1);
}
