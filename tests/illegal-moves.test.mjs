import test from "node:test";
import assert from "node:assert/strict";
import { at, boardHash, newGame, play, BLACK, WHITE } from "../public/core.mjs";
import { makeReviewUrl,readReviewUrl } from "../public/sgf-link.mjs";
import {
  illegalMoveReasons, inspectProvisionalMove, makeIllegalMovePrompt, ILLEGAL_KO, ILLEGAL_SUICIDE
} from "../public/illegal-moves.mjs";
import {source} from "./helpers/source.mjs";

// Build both forbidden positions through legal play so the SGF URL and board agree.
function suicidePosition() {
  let state=newGame();
  for(const p of [null,at(1,0),null,at(0,1),null,at(2,1),null,at(1,2)])
    state=play(state,p);
  return state;
}
function koPosition() {
  let state=newGame();
  for(const p of [at(3,4),at(4,4),at(5,4),at(3,3),
    at(4,5),at(5,3),null,at(4,2),at(4,3)])
    state=play(state,p);
  return state;
}
function question(game,forbidden){
  const link=makeReviewUrl("https://miego.example",{snapshot:game},game.moves.length);
  assert.equal(readReviewUrl(link).snapshot.board.join(),game.board.join());
  return {link,text:makeIllegalMovePrompt(game,forbidden,link)};
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
test("ko explanation contains a matching SGF URL, ◇ board, and prior board but no coordinates",()=>{
  const game=koPosition(),attempt=inspectProvisionalMove(game,at(4,4)).forbidden;
  const {link,text}=question(game,attempt);
  assert.ok(text.includes("棋譜URL: "+link));
  assert.match(text,/sgf=/);
  assert.match(text,/禁止理由：コウ/);
  assert.match(text,/直前の着手前の盤面/);
  assert.match(text,/●=黒、○=白、・=空点/);
  assert.match(text,/◇=打とうとした空点/);
  const current=text.split("現在の盤面：\n")[1].split("\n\n直前")[0];
  assert.equal(current.split("\n").length,9);
  assert.equal(current.split("\n")[4].split(" ")[4],"◇");
  assert.doesNotMatch(current,/[A-Z0-9]/);
  assert.doesNotMatch(text,/交点：[A-J]\d|選択した交点|guestKey|TURNSTILE_SECRET|招待URL/);
  assert.throws(()=>makeIllegalMovePrompt(game,null,link));
  assert.throws(()=>makeIllegalMovePrompt(game,attempt,"https://miego.example/?room=private"));
});
test("suicide question includes its SGF replay URL but not prior-board snapshot",()=>{
  const game=suicidePosition(),attempt=inspectProvisionalMove(game,at(1,1)).forbidden;
  const {link,text}=question(game,attempt);
  assert.ok(text.includes(link));
  assert.match(text,/禁止理由：自殺手/);
  assert.equal(text.split("現在の盤面：\n")[1].split("\n")[1].split(" ")[1],"◇");
  assert.doesNotMatch(text,/直前の着手前の盤面/);
});
test("no forbidden markers, no status coordinates, normal-weight matching type",()=>{
  const app=source("app.mjs");
  const renderer=source("board-renderer.mjs");
  const html=source("index.html");
  const style=source("style.css");
  assert.doesNotMatch(renderer,/drawIllegalMoveMarker|paintIllegalMarkers|illegalMoveReasons/);
  assert.match(renderer,/illegalCandidate\?\.position/);
  assert.match(app,/inspectProvisionalMove\(game,position\)/);
  assert.match(app,/\$\("confirm"\)\.disabled=!candidate \|\| !myTurn \|\| blocked/);
  assert.match(app,/makeReviewUrl\(location\.origin,\{snapshot:game\},game\.moves\.length\)/);
  assert.match(app,/makeIllegalMovePrompt\(game,selected,link\)/);
  assert.doesNotMatch(app,/pointLabel\(illegalCandidate\.position\)/);
  assert.match(app,/classList\.toggle\("has-illegal",blocked\)/);
  assert.match(style,/\.action-row #confirm\{font-size:var\(--font-body\)\}/);
  assert.match(style,/font-size:var\(--font-body\);font-weight:var\(--weight-regular\);line-height:1\.3/);
  assert.match(style,/--weight-regular:400;--weight-medium:600;--weight-bold:700;/);
  assert.doesNotMatch(style,/\.endgame-bar\.has-illegal \.end-status\{[^}]*font-weight:750/);
  assert.doesNotMatch(html,/illegalMoveLegend|illegalMoveToggle/);
});
