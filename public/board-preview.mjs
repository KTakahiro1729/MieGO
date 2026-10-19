/** Display captured stones faintly while a move is only provisional. */
export function stoneForPreview(committedBoard, candidateBoard, index) {
  const committed = committedBoard[index];
  if (!candidateBoard) return { color: committed, captured: false };
  const proposed = candidateBoard[index];
  return {
    color: proposed || committed,
    captured: committed !== 0 && proposed === 0
  };
}
