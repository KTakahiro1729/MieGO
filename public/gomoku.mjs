// 五目並べ (gomoku), free-style: no forbidden moves for either side, and a
// line of five or more in a row (an overline too) wins. A full board with no
// such line is a draw. Self-contained so that core.mjs can import it.
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

/** True when the stone at `position` makes five or more in a row. */
export function makesFive(board, position) {
  const color = board[position];
  return !!color && DIRECTIONS.some(d => runLength(board, position, color, d) >= 5);
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

/**
 * Where the computer plays: each empty point near the stones is scored by the
 * lines it would make for itself (attack) and for the opponent (defence).
 * Winning beats blocking a win, which beats everything else.
 */
export function gomokuMove(board, color, random = Math.random) {
  const size = sideOf(board);
  if (board.every(stone => !stone)) return Math.floor(board.length / 2);
  let best = [], bestScore = -1;
  for (let p = 0; p < board.length; p++) {
    if (board[p] || !nearStone(board, p, size)) continue;
    const score = pointScore(board, p, color, size) * 1.1 + pointScore(board, p, -color, size);
    if (score > bestScore) { bestScore = score; best = [p]; }
    else if (score === bestScore) best.push(p);
  }
  return best.length ? best[Math.floor(random() * best.length)] : board.indexOf(0);
}
function nearStone(board, p, size) {
  const x0 = p % size, y0 = Math.floor(p / size);
  for (let y = Math.max(0, y0 - 2); y <= Math.min(size - 1, y0 + 2); y++)
    for (let x = Math.max(0, x0 - 2); x <= Math.min(size - 1, x0 + 2); x++)
      if (board[y * size + x]) return true;
  return false;
}
// A run's value by its length and how many of its ends are open.
const RUN_VALUE = [
  [0, 0, 0], [0, 1, 4], [0, 10, 40], [0, 100, 1000], [0, 1000, 20000],
];
function pointScore(board, p, color, size) {
  const x0 = p % size, y0 = Math.floor(p / size);
  let total = 0;
  for (const [dx, dy] of DIRECTIONS) {
    let count = 1, open = 0;
    for (const sign of [1, -1]) {
      let x = x0 + dx * sign, y = y0 + dy * sign;
      while (x >= 0 && y >= 0 && x < size && y < size && board[y * size + x] === color) {
        count++; x += dx * sign; y += dy * sign;
      }
      if (x >= 0 && y >= 0 && x < size && y < size && !board[y * size + x]) open++;
    }
    total += count >= 5 ? 1e6 : RUN_VALUE[count][open];
  }
  return total;
}
