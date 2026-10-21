// The 五目並べ COM. Every empty point near the stones is scored by the shapes
// it makes along each line, for itself (attack) and for the opponent
// (defence): a five, a four (one point from five), a straight four (two such
// points), a three (one move from a straight four, split threes too), and
// the stones in each open stretch of five. A five comes first, then blocking
// the opponent's five, then the best-scored point. つよい and 最強 also look
// for a win by fours in a row (VCF) and read a few moves ahead; the weaker
// levels miss some of the opponent's threats and pick looser moves.
// Measured against each other and simple players: docs/GOMOKU_AI.md.
import {forbiddenReason} from "./gomoku.mjs";

const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const sideOf = board => Math.round(Math.sqrt(board.length));

// How each level plays. `seeFour` and `seeThree` are the chances, each move,
// of noticing the opponent's five-to-be and its three (or other move that
// would make a straight four); `spread` is how far below the best score a
// move may be picked, as a share of it; `vcf` is how many fours in a row it
// reads; `depth` and `width` are how many moves ahead it reads and among how
// many likeliest moves, within `nodes` positions.
export const GOMOKU_LEVELS = Object.freeze({
  beginner:{seeFour:0.8, seeThree:0.4, spread:0.4},
  easy:{seeFour:1, seeThree:0.85, spread:0.1},
  normal:{seeFour:1, seeThree:1, spread:0},
  strong:{seeFour:1, seeThree:1, spread:0, vcf:12, depth:2, width:8, nodes:3000},
  strongest:{seeFour:1, seeThree:1, spread:0, vcf:16, depth:4, width:6, nodes:10000},
});
const levelOf = strength => GOMOKU_LEVELS[strength] ?? GOMOKU_LEVELS.strong;

// Shapes through a point, from the line it lies on.
const NONE = 0, THREE_CLOSED = 1, THREE = 2, FOUR = 3, FOUR_OPEN = 4, FIVE = 5;
const REACH = 5, OWN = 1, EMPTY = 0, BLOCK = 2;

/** Cells `REACH` either side of `p` along `[dx,dy]`, as OWN/EMPTY/BLOCK for `color`. */
function readLine(board, p, color, [dx, dy], n, out) {
  const x0 = p % n, y0 = (p - x0) / n;
  for (let t = -REACH; t <= REACH; t++) {
    const x = x0 + dx * t, y = y0 + dy * t;
    const stone = x >= 0 && y >= 0 && x < n && y < n ? board[y * n + x] : 2;
    out[t + REACH] = stone === color ? OWN : stone === 0 ? EMPTY : BLOCK;
  }
  return out;
}
function runAt(line, i) {
  let lo = i, hi = i;
  while (line[lo - 1] === OWN) lo--;
  while (line[hi + 1] === OWN) hi++;
  return [lo, hi];
}
const fiveRun = (len, exact) => exact ? len === 5 : len >= 5;
/** Empty points that would make five together with the centre. */
function winPoints(line, exact) {
  const c = REACH;
  let count = 0, first = -1, last = -1;
  for (let i = c - 4; i <= c + 4; i++) {
    if (line[i] !== EMPTY) continue;
    line[i] = OWN;
    const [lo, hi] = runAt(line, i);
    if (lo <= c && c <= hi && fiveRun(hi - lo + 1, exact)) {
      count++; if (first < 0) first = i; last = i;
    }
    line[i] = EMPTY;
  }
  return {count, first, last};
}
/** The strongest shape the centre stone makes along this line. */
function shapeOf(line, exact) {
  const c = REACH;
  const [lo, hi] = runAt(line, c);
  if (fiveRun(hi - lo + 1, exact)) return FIVE;
  // A three needs three stones within reach, a four four.
  let stones = 0;
  for (let i = c - 4; i <= c + 4; i++) if (line[i] === OWN) stones++;
  if (stones < 3) return NONE;
  const wins = winPoints(line, exact);
  if (wins.count >= 2) return FOUR_OPEN;
  if (wins.count === 1) return FOUR;
  let closed = false;
  for (let i = c - 4; i <= c + 4; i++) {
    if (line[i] !== EMPTY) continue;
    line[i] = OWN;
    const next = winPoints(line, exact);
    line[i] = EMPTY;
    // A straight four: two points to five, side by side across the four.
    if (next.count >= 2 && next.last - next.first === 5) return THREE;
    if (next.count >= 1) closed = true;
  }
  return closed ? THREE_CLOSED : NONE;
}
// Stones of one colour in an open stretch of five through the centre.
const STRETCH_VALUE = [0, 1, 8, 40, 200, 0];
function stretchValue(line) {
  const c = REACH;
  let total = 0;
  for (let start = c - 4; start <= c; start++) {
    let own = 0, blocked = false;
    for (let i = start; i < start + 5; i++) {
      if (line[i] === BLOCK) { blocked = true; break; }
      if (line[i] === OWN) own++;
    }
    if (!blocked) total += STRETCH_VALUE[own];
  }
  return total;
}

const scratch = new Array(2 * REACH + 1);
/**
 * The shapes `color` would make by playing empty `p`: counts of each shape
 * over the four lines, and the open stretches' value.
 */
function shapesAt(board, p, color, n, exact) {
  const counts = [0, 0, 0, 0, 0, 0];
  let stretch = 0;
  board[p] = color;
  for (const direction of DIRECTIONS) {
    const line = readLine(board, p, color, direction, n, scratch);
    counts[shapeOf(line, exact)]++;
    stretch += stretchValue(line);
  }
  board[p] = 0;
  return {counts, stretch};
}
// What a set of shapes is worth. A straight four, two fours, or a four with
// a three each win by force; two threes nearly so.
function shapeValue({counts, stretch}) {
  if (counts[FIVE]) return 1e9;
  const fours = counts[FOUR] + counts[FOUR_OPEN];
  if (counts[FOUR_OPEN] || fours >= 2) return 1e8;
  if (fours && counts[THREE]) return 1e7;
  if (counts[THREE] >= 2) return 1e6;
  return fours * 5000 + counts[THREE] * 4000 + counts[THREE_CLOSED] * 500 + stretch;
}

function nearStone(board, p, n, reach = 2) {
  const x0 = p % n, y0 = (p - x0) / n;
  for (let y = Math.max(0, y0 - reach); y <= Math.min(n - 1, y0 + reach); y++)
    for (let x = Math.max(0, x0 - reach); x <= Math.min(n - 1, x0 + reach); x++)
      if (board[y * n + x]) return true;
  return false;
}

/** The rules a side plays under: Black under 禁じ手 needs exactly five and skips forbidden points. */
function sideRules(color, forbidden) {
  const renju = forbidden && color === 1;
  return {exact: renju, allowed: renju ? (board, p) => !forbiddenReason(board, p) : () => true};
}

function candidates(board, n) {
  const list = [];
  for (let p = 0; p < board.length; p++) if (!board[p] && nearStone(board, p, n)) list.push(p);
  return list;
}

/** Points where `color` makes five now. */
function fivePoints(board, color, n, rules, list = candidates(board, n)) {
  return list.filter(p => {
    if (!rules.allowed(board, p)) return false;
    board[p] = color;
    let five = false;
    for (const direction of DIRECTIONS) {
      const [lo, hi] = runAt(readLine(board, p, color, direction, n, scratch), REACH);
      if (fiveRun(hi - lo + 1, rules.exact)) { five = true; break; }
    }
    board[p] = 0;
    return five;
  });
}

/** Points that make five with the stone of `color` at `p`, along the lines through it. */
function fivesThrough(board, p, color, n, exact) {
  const points = [], x0 = p % n, y0 = (p - x0) / n;
  for (const direction of DIRECTIONS) {
    const line = readLine(board, p, color, direction, n, scratch);
    for (let i = REACH - 4; i <= REACH + 4; i++) {
      if (line[i] !== EMPTY) continue;
      line[i] = OWN;
      const [lo, hi] = runAt(line, i);
      line[i] = EMPTY;
      if (lo <= REACH && REACH <= hi && fiveRun(hi - lo + 1, exact)) {
        const point = (y0 + direction[1] * (i - REACH)) * n + x0 + direction[0] * (i - REACH);
        if (!points.includes(point)) points.push(point);
      }
    }
  }
  return points;
}

/**
 * Whether `color` (to move) wins by fours alone: each four forces the one
 * reply, until a five, or a four the opponent cannot stop. Returns the
 * first move, or -1.
 */
function findVcf(board, color, n, rules, otherRules, depth) {
  const list = candidates(board, n);
  const five = fivePoints(board, color, n, rules, list);
  if (five.length) return five[0];
  // The opponent's five comes first.
  if (fivePoints(board, -color, n, otherRules, list).length) return -1;
  return vcfFrom(board, color, n, rules, otherRules, depth, list);
}
// Neither side has a five to play here.
function vcfFrom(board, color, n, rules, otherRules, depth, list = candidates(board, n)) {
  if (depth <= 0) return -1;
  for (const p of list) {
    if (board[p] || !rules.allowed(board, p)) continue;
    board[p] = color;
    const wins = fivesThrough(board, p, color, n, rules.exact);
    let won = wins.length >= 2;
    if (wins.length === 1) {
      const reply = wins[0];
      // A point Black may not play under 禁じ手 cannot be blocked.
      if (!otherRules.allowed(board, reply)) won = true;
      else {
        board[reply] = -color;
        // A block that makes a four of the opponent's own breaks the sequence.
        won = !fivesThrough(board, reply, -color, n, otherRules.exact).length &&
          vcfFrom(board, color, n, rules, otherRules, depth - 1) >= 0;
        board[reply] = 0;
      }
    }
    board[p] = 0;
    if (won) return p;
  }
  return -1;
}

/**
 * Where the COM plays `color` on `board` at `strength` (one of the COM's
 * strength levels; つよい when unknown). `random` breaks ties and drives the
 * weaker levels' slips.
 */
export function gomokuMove(board, color, random = Math.random, {forbidden = false, strength = "strong"} = {}) {
  const n = sideOf(board), level = levelOf(strength);
  if (board.every(stone => !stone)) return Math.floor(board.length / 2);
  const work = [...board];
  const mine = sideRules(color, forbidden), theirs = sideRules(-color, forbidden);
  const list = candidates(work, n).filter(p => mine.allowed(work, p));
  if (!list.length) {
    const open = board.findIndex((stone, p) => !stone && mine.allowed(work, p));
    return open >= 0 ? open : board.indexOf(0);
  }
  const pick = points => points[Math.floor(random() * points.length)];
  const wins = fivePoints(work, color, n, mine, list);
  if (wins.length) return pick(wins);
  const threats = fivePoints(work, -color, n, theirs).filter(p => mine.allowed(work, p));
  const sees = {four: random() < level.seeFour, three: random() < level.seeThree};
  if (threats.length && sees.four) return best(work, threats, color, n, mine, theirs, level, sees, random);
  if (level.vcf) {
    const vcf = findVcf(work, color, n, mine, theirs, level.vcf);
    if (vcf >= 0) return vcf;
  }
  if (level.depth) {
    const rules = {[color]: mine, [-color]: theirs};
    // A budget of positions keeps the strength the same on any device; the
    // clock only guards a slow one.
    const limit = {nodes: level.nodes, until: Date.now() + 1500};
    const ranked = rank(work, list, color, n, mine, theirs, sees).slice(0, level.width);
    // Ties go to the likelier move, which comes first.
    let bestValue = -Infinity, chosen = ranked[0].p;
    for (const {p} of ranked) {
      work[p] = color;
      const value = -search(work, -color, n, rules, level.depth - 1, level.width, -Infinity, -bestValue, limit);
      work[p] = 0;
      if (value > bestValue) { bestValue = value; chosen = p; }
      if (spent(limit)) break;
    }
    return chosen;
  }
  return best(work, list, color, n, mine, theirs, level, sees, random);
}
const WIN = 1e12, QUIESCENCE = 4, QUIESCENCE_WIDTH = 4;
const spent = limit => limit.nodes <= 0 || Date.now() > limit.until;
/**
 * The value of the position for `color` to move, reading `depth` more moves
 * among the `width` likeliest, by negamax with alpha-beta. Blocking a five is
 * read without using up depth.
 */
function search(board, color, n, rules, depth, width, alpha, beta, limit) {
  limit.nodes--;
  const mine = rules[color], theirs = rules[-color], list = candidates(board, n);
  if (fivePoints(board, color, n, mine, list).length) return WIN;
  const fives = fivePoints(board, -color, n, theirs, list), threats = fives.filter(p => mine.allowed(board, p));
  // Two fives to stop, or one on a point Black may not play, cannot be stopped.
  if (fives.length >= 2 || threats.length < fives.length) return -WIN;
  const allowed = list.filter(p => mine.allowed(board, p));
  if (!allowed.length) return 0;
  let moves;
  if (threats.length) moves = threats;
  else {
    const scored = scoreAll(board, allowed, color, n, mine, theirs);
    if (depth <= 0 || spent(limit)) {
      // A straight four of the side to move wins; the opponent's threat to
      // make one is read on, with only the moves that answer it, until quiet.
      const own = Math.max(...scored.map(s => s.attack)), other = Math.max(...scored.map(s => s.defence));
      if (own >= 1e8) return WIN / 2;
      if (other < 1e8 || depth <= -QUIESCENCE || spent(limit)) return staticValue(scored);
      scored.sort((a, b) => b.score - a.score);
      moves = scored.filter(s => s.defence >= 1e8 || s.attack >= 5000).slice(0, QUIESCENCE_WIDTH).map(({p}) => p);
    } else moves = scored.sort((a, b) => b.score - a.score).slice(0, width).map(({p}) => p);
  }
  let value = -Infinity;
  for (const p of moves) {
    board[p] = color;
    const v = -search(board, -color, n, rules, threats.length ? depth : depth - 1, width, -beta, -alpha, limit);
    board[p] = 0;
    if (v > value) value = v;
    if (value > alpha) alpha = value;
    if (alpha >= beta) break;
  }
  return value;
}
function scoreAll(board, list, color, n, mine, theirs) {
  return list.map(p => {
    const attack = shapeValue(shapesAt(board, p, color, n, mine.exact));
    const defence = shapeValue(shapesAt(board, p, -color, n, theirs.exact));
    return {p, attack, defence, score: attack * 1.2 + defence};
  });
}
// The side to move gets its best shapes; the opponent's count for less,
// since the side to move can block the best of them first.
function staticValue(scored) {
  const own = scored.map(s => s.attack).sort((a, b) => b - a);
  const other = scored.map(s => s.defence).sort((a, b) => b - a);
  const top3 = (values, second, third) => values[0] + (values[1] ?? 0) * second + (values[2] ?? 0) * third;
  return top3(own, 0.3, 0.1) - 0.6 * top3(other, 0.45, 0.15);
}
function rank(board, list, color, n, mine, theirs, sees) {
  return scoreAll(board, list, color, n, mine, theirs).map(({p, attack, defence}) => {
    // A missed threat leaves only the open stretches of the opponent's line.
    if (!sees.four && defence >= 1e9 || !sees.three && defence >= 4000 && defence < 1e9) defence = 200;
    return {p, score: attack * 1.2 + defence};
  }).sort((a, b) => b.score - a.score);
}
function best(board, list, color, n, mine, theirs, level, sees, random) {
  const ranked = rank(board, list, color, n, mine, theirs, sees);
  const top = ranked[0].score, floor = top * (1 - level.spread);
  const pool = ranked.filter(({score}) => score >= floor);
  return pool[Math.floor(random() * pool.length)].p;
}
