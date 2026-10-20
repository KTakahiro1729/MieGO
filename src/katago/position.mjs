// Pure adapter from MieGO's -1/0/+1 flat board and replay record to KataGo v7.
// Board sizes MieGO can play; the network itself is size-independent.
const SIZES = [9, 13, 19];
/** Side length of a flat board, or null for an unsupported shape. */
export function boardSizeOf(board) {
  const size = Math.sqrt(board?.length);
  return SIZES.includes(size) ? size : null;
}
const normalized = (board, size) => Array.from({ length: size }, (_, y) =>
  Array.from({ length: size }, (_, x) => {
    const v = board[y * size + x];
    return v === 1 ? "black" : v === -1 ? "white" : null;
  })
);
export function fromBoardHash(hash, size = 9) {
  if (typeof hash !== "string" || hash.length !== size * size || /[^012]/.test(hash))
    throw new Error("Invalid MieGO board history");
  // MieGO hashes -1=>0, empty=>1, +1=>2.
  return normalized(Array.from(hash, c => Number(c) - 1), size);
}
export function toKataGoPosition(state) {
  const size = boardSizeOf(state?.board);
  if (!state || !Array.isArray(state.board) || !size
      || state.board.some(v => ![-1, 0, 1].includes(v))
      || !Array.isArray(state.moves) || ![-1, 1].includes(state.next)) {
    throw new Error("Invalid board supplied to KataGo");
  }
  // A free board's stones were set up, not played: it has no move history to read.
  const free = state.rules === "free";
  const history = Array.isArray(state.history) && !free ? state.history : [];
  const moves = free ? [] : state.moves.filter(m => m && [1, -1].includes(m.color) &&
    (m.position === null || Number.isInteger(m.position) && m.position >= 0 && m.position < size * size));
  return {
    size,
    board: normalized(state.board, size),
    previousBoard: history.length > 1 ? fromBoardHash(history[history.length - 2], size) : undefined,
    previousPreviousBoard: history.length > 2 ? fromBoardHash(history[history.length - 3], size) : undefined,
    currentPlayer: state.next === 1 ? "black" : "white",
    moveHistory: moves.map(m => ({
      player: m.color === 1 ? "black" : "white",
      x: m.position === null ? -1 : m.position % size,
      y: m.position === null ? -1 : Math.floor(m.position / size)
    }))
  };
}
