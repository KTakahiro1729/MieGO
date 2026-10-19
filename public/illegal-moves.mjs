import { SIZE, play } from "./core.mjs";

export const ILLEGAL_SUICIDE = "suicide";
export const ILLEGAL_KO = "ko";

/** Use the actual game engine, not a separate approximation, to identify
 * empty intersections prohibited for the player whose turn it is.
 */
export function illegalMoveReasons(state) {
  const reasons = new Map();
  if(state.status !== "playing") return reasons;
  for(let position=0;position<SIZE*SIZE;position++) {
    if(state.board[position] !== 0) continue;
    try {
      play(state, position);
    } catch(error) {
      if(error instanceof Error && error.message === "自殺手は禁止です")
        reasons.set(position, ILLEGAL_SUICIDE);
      else if(error instanceof Error && error.message === "コウで直前の局面に戻せません")
        reasons.set(position, ILLEGAL_KO);
    }
  }
  return reasons;
}

/** Both reasons use precisely the same circle, color, opacity and stroke.
 * Only the central slash or cross differs. Draw on the existing canvas.
 */
export function drawIllegalMoveMarker(ctx, x, y, gap, reason) {
  if(reason !== ILLEGAL_KO && reason !== ILLEGAL_SUICIDE) return;
  const radius=gap*.18;
  const inner=radius*.57;
  ctx.save();
  ctx.globalAlpha=.84;
  ctx.fillStyle="#ecdfc4";
  ctx.strokeStyle="#4d4a44";
  ctx.lineWidth=Math.max(1.7,gap*.032);
  ctx.lineCap="round";
  ctx.beginPath();
  ctx.arc(x,y,radius,0,Math.PI*2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  // Ko: circle with slash. Suicide: circle with cross.
  ctx.moveTo(x-inner,y+inner);
  ctx.lineTo(x+inner,y-inner);
  if(reason===ILLEGAL_SUICIDE) {
    ctx.moveTo(x-inner,y-inner);
    ctx.lineTo(x+inner,y+inner);
  }
  ctx.stroke();
  ctx.restore();
}
