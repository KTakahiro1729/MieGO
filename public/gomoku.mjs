// 五目並べ (gomoku). Free-style by default: no forbidden moves for either
// side, and a line of five or more in a row (an overline too) wins. With
// 禁じ手 (renju's forbidden moves), Black may not make a double three (三三),
// a double four (四四) or an overline (長連), and only exactly five wins for
// Black; five takes precedence over a forbidden shape. White is unrestricted.
// A full board with no such line is a draw. Self-contained so that core.mjs
// can import it.
const DIRECTIONS = [[1, 0], [0, 1], [1, 1], [1, -1]];
const sideOf = board => Math.round(Math.sqrt(board.length));

/** Stones of `color` in a row through `position`, along one direction. */
function runLength(board, position, color, [dx, dy], size = sideOf(board)) {
  const x0 = position % size, y0 = Math.floor(position / size);
  let count = 1;
  for (const sign of [1, -1]) {
    let x = x0 + dx * sign, y = y0 + dy * sign;
    while (x >= 0 && y >= 0 && x < size && y < size && board[y * size + x] === color) {
      count++; x += dx * sign; y += dy * sign;
    }
  }
  return count;
}

/** True when the stone at `position` makes five or more in a row (exactly five with `exact`). */
export function makesFive(board, position, exact = false) {
  const color = board[position];
  return !!color && DIRECTIONS.some(d => {
    const run = runLength(board, position, color, d);
    return exact ? run === 5 : run >= 5;
  });
}

export const FORBIDDEN_DOUBLE_THREE = "doubleThree";
export const FORBIDDEN_DOUBLE_FOUR = "doubleFour";
export const FORBIDDEN_OVERLINE = "overline";
// The line through a point, `REACH` cells either way: enough for every five,
// four and three that can pass through it. Off the board counts as a wall.
const REACH = 9, WALL = 2;
function lineThrough(board, position, [dx, dy], size) {
  const x0 = position % size, y0 = Math.floor(position / size), line = [];
  for (let t = -REACH; t <= REACH; t++) {
    const x = x0 + dx * t, y = y0 + dy * t;
    line.push(x >= 0 && y >= 0 && x < size && y < size ? board[y * size + x] : WALL);
  }
  return line;
}
function runIn(line, i, color) {
  let lo = i, hi = i;
  while (line[lo - 1] === color) lo--;
  while (line[hi + 1] === color) hi++;
  return [lo, hi];
}
/** Fours through the centre: points that would make exactly five with it. */
function foursIn(line, color) {
  const c = REACH, points = [];
  for (let i = c - 4; i <= c + 4; i++) {
    if (line[i] !== 0) continue;
    line[i] = color;
    const [lo, hi] = runIn(line, i, color);
    if (hi - lo + 1 === 5 && lo <= c && c <= hi) points.push(i);
    line[i] = 0;
  }
  // A straight four (_XXXX_) has two such points but is one four.
  if (points.length === 2 && points[1] - points[0] === 5) return 1;
  return Math.min(points.length, 2);
}
/** A three through the centre: one more stone makes a straight four with it. */
function hasThree(line, color) {
  const c = REACH;
  for (let i = c - 4; i <= c + 4; i++) {
    if (line[i] !== 0) continue;
    line[i] = color;
    const [lo, hi] = runIn(line, i, color);
    const straight = hi - lo + 1 === 4 && lo <= c && c <= hi &&
      line[lo - 1] === 0 && line[hi + 1] === 0 && line[lo - 2] !== color && line[hi + 2] !== color;
    line[i] = 0;
    if (straight) return true;
  }
  return false;
}
/**
 * Why Black may not play at empty `position` under 禁じ手, or null. A move
 * that makes exactly five is always allowed. Simplified from the full renju
 * rule: a three counts even when the point that would make it a straight
 * four is itself forbidden.
 */
export function forbiddenReason(board, position) {
  if (board[position]) return null;
  const size = sideOf(board), color = 1, next = [...board];
  next[position] = color;
  if (makesFive(next, position, true)) return null;
  let fours = 0, threes = 0;
  for (const direction of DIRECTIONS) {
    const line = lineThrough(next, position, direction, size);
    const [lo, hi] = runIn(line, REACH, color);
    if (hi - lo + 1 >= 6) return FORBIDDEN_OVERLINE;
    const four = foursIn(line, color);
    fours += four;
    if (!four && hasThree(line, color)) threes++;
  }
  if (fours >= 2) return FORBIDDEN_DOUBLE_FOUR;
  if (threes >= 2) return FORBIDDEN_DOUBLE_THREE;
  return null;
}

/** The positions of the winning line through `position`, or null. */
export function winningLine(board, position) {
  const color = board[position], size = sideOf(board);
  if (!color) return null;
  for (const [dx, dy] of DIRECTIONS) {
    if (runLength(board, position, color, [dx, dy], size) < 5) continue;
    const line = [position];
    for (const sign of [1, -1]) {
      let x = position % size + dx * sign, y = Math.floor(position / size) + dy * sign;
      while (x >= 0 && y >= 0 && x < size && y < size && board[y * size + x] === color) {
        line.push(y * size + x); x += dx * sign; y += dy * sign;
      }
    }
    return line.sort((a, b) => a - b);
  }
  return null;
}
