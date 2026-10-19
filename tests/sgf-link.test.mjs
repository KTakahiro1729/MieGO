import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at} from "../public/core.mjs";
import {makeReviewUrl,readReviewUrl,makeAiHandoff,MAX_SHARE_URL_LENGTH} from "../public/sgf-link.mjs";

test("a generated URL exposes readable SGF and a precise selected move",()=>{
 let game=newGame();
 for(const p of [at(3,3),at(4,4),null,at(3,4)])game=play(game,p);
 const link=makeReviewUrl("https://miego.example/",{snapshot:game},2);
 const url=new URL(link);
 assert.equal(url.searchParams.get("move"),"2");
 assert.match(url.searchParams.get("sgf"),/^\(;GM\[1\]FF\[4\].*SZ\[9\]/);
 assert.match(url.searchParams.get("sgf"),/;B\[dd\];W\[ee\];B\[\];W\[de\]/);
 const result=readReviewUrl(link);
 assert.equal(result.kind,"review");
 assert.equal(result.step,2);
 assert.equal(result.snapshot.moves.length,4);
 assert.equal(result.snapshot.board[at(3,3)],1);
});
test("AI can change move without altering the entire SGF",()=>{
 const game=play(play(newGame(),at(3,3)),at(4,4));
 const link=makeReviewUrl("https://miego.example",{snapshot:game},1);
 const url=new URL(link);
 const raw=url.searchParams.get("sgf");
 url.searchParams.set("move","0");
 assert.equal(readReviewUrl(url).step,0);
 url.searchParams.delete("move");
 assert.equal(readReviewUrl(url).step,2);
 assert.equal(url.searchParams.get("sgf"),raw);
});
test("AI can generate a fresh alternative SGF URL",()=>{
 const url=new URL("https://miego.example/");
 url.searchParams.set("sgf","(;GM[1]FF[4]SZ[9];B[dd];W[ee];B[ff])");
 url.searchParams.set("move","3");
 const parsed=readReviewUrl(url.href);
 assert.equal(parsed.step,3);
 assert.equal(parsed.snapshot.board[at(5,5)],1);
});
test("pass, escaped URI characters and result are preserved",()=>{
 const game=play(play(play(newGame(),at(2,2)),null),at(3,3));
 const link=makeReviewUrl("https://miego.example",{snapshot:game,sgfMeta:{blackName:"A & B",komi:"7.5"}},3);
 const parsed=readReviewUrl(link);
 assert.equal(parsed.snapshot.moves[1].position,null);
 assert.equal(parsed.metadata.blackName,"A & B");
 assert.ok(link.includes("%3B")&&link.includes("%5B"));
});
test("malformed, duplicated, oversized and illegal moves never become a review",()=>{
 for(const url of [
  "https://example.com/?sgf=",
  "https://example.com/?sgf=not-sgf",
  "https://example.com/?sgf=%28%3BGM%5B1%5DSZ%5B19%5D%29",
  "https://example.com/?sgf=%28%3BGM%5B1%5DSZ%5B9%5D%3BB%5Baa%5D%3BB%5Bbb%5D%29",
  "https://example.com/?sgf=%28%3BGM%5B1%5DSZ%5B9%5D%29&move=-1",
  "https://example.com/?sgf=%28%3BGM%5B1%5DSZ%5B9%5D%29&move=1",
  "https://example.com/?sgf=%28%3BGM%5B1%5DSZ%5B9%5D%29&move=01",
  "https://example.com/?sgf=%28%3BGM%5B1%5DSZ%5B9%5D%29&move=0&move=0",
  "https://example.com/?sgf="+ "a".repeat(MAX_SHARE_URL_LENGTH)
 ])assert.throws(()=>readReviewUrl(url));
});
test("room invitation always takes precedence over any SGF",()=>{
 assert.deepEqual(readReviewUrl("https://miego.example/?room=abc&sgf=INVALID"),{kind:"room"});
 assert.deepEqual(readReviewUrl("https://miego.example/"),{kind:"none"});
});
test("AI handoff includes only link, URI rules and public specification, no duplicate SGF",()=>{
 const url=makeReviewUrl("https://miego.example",{snapshot:play(newGame(),40)},1);
 const text=makeAiHandoff(url);
 assert.ok(text.includes(url));
 assert.ok(text.includes("https://miego.example/ai.md"));
 assert.ok(text.includes("move"));
 assert.match(text,/●=黒、○=白、・=空点/);
 assert.match(text,/選択している局面（1手目）の盤面/);
 assert.equal(text.includes("SGF本文"),false);
 assert.equal(text.includes("次の一手を教えて"),false);
 assert.equal((text.match(/\(;GM\[1\]/g)||[]).length,0);
});

test("AI handoff glyph board matches selected move, not the end of the SGF",()=>{
  const game=play(play(newGame(),at(3,3)),at(4,4));
  const first=makeAiHandoff(makeReviewUrl("https://miego.example",{snapshot:game},1));
  const second=makeAiHandoff(makeReviewUrl("https://miego.example",{snapshot:game},2));
  assert.match(first,/選択している局面（1手目）/);
  assert.match(second,/選択している局面（2手目）/);
  const board1=first.split("上の行から下の行へ9路ずつ表示します。\n")[1].split("\n\nsgf は")[0];
  const board2=second.split("上の行から下の行へ9路ずつ表示します。\n")[1].split("\n\nsgf は")[0];
  assert.equal(board1.split("\n").length,9);
  assert.equal(board2.split("\n").length,9);
  assert.doesNotMatch(board1,/[A-Z0-9]/);
  assert.doesNotMatch(board2,/[A-Z0-9]/);
  assert.equal((board1.match(/●/g)||[]).length,1);
  assert.equal((board1.match(/○/g)||[]).length,0);
  assert.equal((board2.match(/●/g)||[]).length,1);
  assert.equal((board2.match(/○/g)||[]).length,1);
});
