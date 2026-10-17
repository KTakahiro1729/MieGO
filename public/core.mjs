export const SIZE = 9;
export const KOMI = 7.5;
export const BLACK = 1;
export const WHITE = -1;
export const at = (x, y) => y * SIZE + x;
export const xy = n => [n % SIZE, Math.floor(n / SIZE)];
export function neighbors(n) {
  const [x, y] = xy(n), result = [];
  if (x > 0) result.push(n - 1);
  if (x < SIZE - 1) result.push(n + 1);
  if (y > 0) result.push(n - SIZE);
  if (y < SIZE - 1) result.push(n + SIZE);
  return result;
}
export function group(board, index) {
  const color = board[index], stones = new Set(), liberties = new Set();
  if (!color) return { stones, liberties };
  const queue = [index]; stones.add(index);
  for (let head = 0; head < queue.length; head++) {
    for (const n of neighbors(queue[head])) {
      if (board[n] === 0) liberties.add(n);
      else if (board[n] === color && !stones.has(n)) { stones.add(n); queue.push(n); }
    }
  }
  return { stones, liberties };
}
export const boardHash = board => board.map(n => n + 1).join("");
export function newGame(assisted = true) {
  const board = Array(SIZE * SIZE).fill(0);
  return { board, next: BLACK, passes: 0, moves: [], moveNumber: 0,
    captures: { black: 0, white: 0 }, history: [boardHash(board)], status: "playing",
    assisted, dead: [], agreed: { black: false, white: false }, result: null };
}
export function play(state, position) {
  if (state.status !== "playing") throw new Error("対局中ではありません");
  const color = state.next;
  if (position === "resign") return {
    ...state, status: "finished", result: color === BLACK ? "W+R" : "B+R",
    moves: [...state.moves, { color, position: "resign" }]
  };
  if (position === null) {
    const passes = state.passes + 1;
    return { ...state, next: -color, passes, moveNumber: state.moveNumber + 1,
      status: passes >= 2 ? "scoring" : "playing", agreed: { black: false, white: false },
      history: [...state.history, boardHash(state.board)],
      moves: [...state.moves, { color, position: null }] };
  }
  if (!Number.isInteger(position) || position < 0 || position >= SIZE * SIZE || state.board[position]) {
    throw new Error("着手できない交点です");
  }
  const board = [...state.board]; board[position] = color;
  let captured = 0;
  const seen = new Set();
  for (const n of neighbors(position)) {
    if (board[n] !== -color || seen.has(n)) continue;
    const enemy = group(board, n);
    for (const s of enemy.stones) seen.add(s);
    if (enemy.liberties.size === 0) {
      captured += enemy.stones.size;
      for (const s of enemy.stones) board[s] = 0;
    }
  }
  if (group(board, position).liberties.size === 0) throw new Error("自殺手は禁止です");
  const hash = boardHash(board);
  if (state.history.length >= 2 && hash === state.history[state.history.length - 2]) {
    throw new Error("コウで直前の局面に戻せません");
  }
  return {
    ...state, board, next: -color, passes: 0, moveNumber: state.moveNumber + 1,
    history: [...state.history, hash], moves: [...state.moves, { color, position }],
    captures: { black: state.captures.black + (color === BLACK ? captured : 0),
      white: state.captures.white + (color === WHITE ? captured : 0) }
  };
}
export function toggleDead(state, index) {
  if (state.status !== "scoring" || !state.board[index]) throw new Error("石を指定してください");
  const stones = group(state.board, index).stones;
  const dead = new Set(state.dead), removing = [...stones].every(i => dead.has(i));
  for (const i of stones) removing ? dead.delete(i) : dead.add(i);
  return { ...state, dead: [...dead], agreed: { black: false, white: false } };
}
export function resume(state) {
  if (state.status !== "scoring") throw new Error("計算中ではありません");
  return { ...state, status: "playing", passes: 0, agreed: { black: false, white: false } };
}
export function areaScore(state) {
  const board = [...state.board];
  for (const n of state.dead) board[n] = 0;
  const owned = Array(SIZE * SIZE).fill(0);
  let black = 0, white = KOMI;
  for (let i = 0; i < board.length; i++) {
    if (board[i] === BLACK) { black++; owned[i] = BLACK; }
    if (board[i] === WHITE) { white++; owned[i] = WHITE; }
  }
  const visited = new Set();
  for (let i = 0; i < board.length; i++) {
    if (board[i] || visited.has(i)) continue;
    const queue = [i], border = new Set(); visited.add(i);
    for (let head = 0; head < queue.length; head++) {
      for (const n of neighbors(queue[head])) {
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
  if (state.status !== "scoring" || ![BLACK, WHITE].includes(color)) throw new Error("計算中ではありません");
  const agreed = { ...state.agreed, [color === BLACK ? "black" : "white"]: true };
  if (!agreed.black || !agreed.white) return { ...state, agreed };
  const s = areaScore(state);
  return { ...state, agreed, status: "finished",
    result: (s.difference > 0 ? "B+" : "W+") + Math.abs(s.difference).toFixed(1) };
}
export function setAssisted(state, value) {
  if (state.moveNumber !== 0) throw new Error("開始後はモードを変更できません");
  return { ...state, assisted: !!value };
}
export function toSGF(state) {
  const enc = c => c === BLACK ? "B" : "W";
  const coord = n => {
    if (n === null) return "";
    const [x, y] = xy(n); return String.fromCharCode(97 + x, 97 + y);
  };
  const moves = state.moves.filter(m => m.position !== "resign")
    .map(m => ";" + enc(m.color) + "[" + coord(m.position) + "]").join("");
  return "(;GM[1]FF[4]CA[UTF-8]SZ[9]KM[7.5]RU[Chinese]" +
    (state.result ? "RE[" + state.result + "]" : "") + moves + ")";
}
