// Pure adapter from MieGO's -1/0/+1 flat board and replay record to KataGo v7.
const SIZE = 9;
const normalized = board => Array.from({ length: SIZE }, (_, y) =>
  Array.from({ length: SIZE }, (_, x) => {
    const v = board[y * SIZE + x];
    return v === 1 ? "black" : v === -1 ? "white" : null;
  })
);
export function fromBoardHash(hash) {
  if (typeof hash !== "string" || hash.length !== SIZE * SIZE || /[^012]/.test(hash))
    throw new Error("Invalid MieGO board history");
  // MieGO hashes -1=>0, empty=>1, +1=>2.
  return normalized(Array.from(hash, c => Number(c) - 1));
}
export function toKataGoPosition(state) {
  if (!state || !Array.isArray(state.board) || state.board.length !== 81
      || state.board.some(v => ![-1, 0, 1].includes(v))
      || !Array.isArray(state.moves) || ![-1, 1].includes(state.next)) {
    throw new Error("Invalid board supplied to KataGo");
  }
  const history = Array.isArray(state.history) ? state.history : [];
  const moves = state.moves.filter(m => m && [1, -1].includes(m.color) &&
    (m.position === null || Number.isInteger(m.position) && m.position >= 0 && m.position < 81));
  return {
    board: normalized(state.board),
    previousBoard: history.length > 1 ? fromBoardHash(history[history.length - 2]) : undefined,
    previousPreviousBoard: history.length > 2 ? fromBoardHash(history[history.length - 3]) : undefined,
    currentPlayer: state.next === 1 ? "black" : "white",
    moveHistory: moves.map(m => ({
      player: m.color === 1 ? "black" : "white",
      x: m.position === null ? -1 : m.position % SIZE,
      y: m.position === null ? -1 : Math.floor(m.position / SIZE)
    }))
  };
}
