import test from "node:test";
import assert from "node:assert/strict";
import { at, boardHash, newGame, play, BLACK, WHITE } from "../public/core.mjs";
import {
  illegalMoveReasons, inspectProvisionalMove, makeIllegalMovePrompt,pointLabel,ILLEGAL_KO,ILLEGAL_SUICIDE
} from "../public/illegal-moves.mjs";
import {readFileSync} from "node:fs";

function suicidePosition() {
  const state=newGame();
  for(const p of [at(1,0),at(0,1),at(2,1),at(1,2)])state.board[p]=WHITE;
  state.history=[boardHash(state.board)];
  return state;
}
function koPosition() {
  const state=newGame();
  for(const p of [at(3,4),at(5,4),at(4,5)])state.board[p]=BLACK;
  for(const p of [at(4,4),at(3,3),at(5,3),at(4,2)])state.board[p]=WHITE;
  state.history=[boardHash(state.board)];
  return play(state,at(4,3));
}
test("forbidden suicide is selectable as a preview without changing the game",()=>{
  const game=suicidePosition(),before=JSON.stringify(game);
  const selected=inspectProvisionalMove(game,at(1,1));
  assert.equal(selected.candidate,null);
  assert.equal(selected.forbidden.reason,ILLEGAL_SUICIDE);
  assert.equal(selected.forbidden.position,at(1,1));
  assert.equal(selected.forbidden.source,game);
  assert.equal(JSON.stringify(game),before);
  assert.equal(illegalMoveReasons(game).get(at(1,1)),ILLEGAL_SUICIDE);
});
test("legal capture is still playable and not marked forbidden",()=>{
  const game=newGame();
  game.board[at(1,1)]=WHITE;
  for(const p of [at(1,0),at(0,1),at(2,1)])game.board[p]=BLACK;
  game.history=[boardHash(game.board)];
  const result=inspectProvisionalMove(game,at(1,2));
  assert.ok(result.candidate);
  assert.equal(result.forbidden,null);
  assert.equal(illegalMoveReasons(game).has(at(1,2)),false);
});
test("ko recapture can be previewed but is not a legal move",()=>{
  const game=koPosition();
  assert.throws(()=>play(game,at(4,4)),/コウ/);
  const attempt=inspectProvisionalMove(game,at(4,4));
  assert.equal(attempt.candidate,null);
  assert.equal(attempt.forbidden.reason,ILLEGAL_KO);
  assert.equal(illegalMoveReasons(game).get(at(4,4)),ILLEGAL_KO);
});
test("occupied points and non-playing states never get forbidden previews",()=>{
  const game=suicidePosition();
  assert.deepEqual(inspectProvisionalMove(game,at(1,0)),{candidate:null,forbidden:null});
  assert.deepEqual(inspectProvisionalMove({...game,status:"scoring"},at(1,1)),{candidate:null,forbidden:null});
  assert.equal(illegalMoveReasons({...game,status:"finished"}).size,0);
});
test("copied rule question names coordinate, current board, and ko history but not private URLs",()=>{
  const game=koPosition(),attempt=inspectProvisionalMove(game,at(4,4)).forbidden;
  const question=makeIllegalMovePrompt(game,attempt);
  assert.match(question,/9路盤/);
  assert.match(question,/交点 E5/);
  assert.match(question,/コウで直前の局面に戻せません/);
  assert.match(question,/直前の着手前の盤面/);
  assert.match(question,/X=黒石、O=白石/);
  assert.doesNotMatch(question,/workers\.dev|guestKey|TURNSTILE_SECRET|招待URL/);
  assert.equal(pointLabel(at(0,8)),"A1");
  assert.equal(pointLabel(at(8,0)),"J9");
  assert.throws(()=>makeIllegalMovePrompt(game,null));
});
test("suicide question includes location and rule but no redundant previous snapshot",()=>{
  const game=suicidePosition(),attempt=inspectProvisionalMove(game,at(1,1)).forbidden;
  const question=makeIllegalMovePrompt(game,attempt);
  assert.match(question,/交点 B8/);
  assert.match(question,/自殺手は禁止です/);
  assert.doesNotMatch(question,/直前の着手前の盤面/);
});
test("board has no advance forbidden markers; only selected move has preview and copy CTA",()=>{
  const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
  const renderer=readFileSync(new URL("../public/board-renderer.mjs",import.meta.url),"utf8");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.doesNotMatch(renderer,/drawIllegalMoveMarker|paintIllegalMarkers|illegalMoveReasons/);
  assert.match(renderer,/illegalCandidate\?\.position/);
  assert.match(app,/inspectProvisionalMove\(game,position\)/);
  assert.match(app,/\$\("confirm"\)\.disabled=!candidate \|\| !myTurn \|\| blocked/);
  assert.match(app,/makeIllegalMovePrompt\(game,selected\)/);
  assert.match(html,/id="copyIllegalPrompt"/);
  assert.match(html,/id="illegalMoveNotice"/);
  assert.doesNotMatch(html,/illegalMoveLegend|illegalMoveToggle/);
});
