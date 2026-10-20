import test from "node:test";
import assert from "node:assert/strict";
import { createStrongWorkers } from "../public/strong-worker.mjs";

function setup(size = 9) {
  const made = [], heard = [];
  const workers = createStrongWorkers({
    boardSize:() => size,
    onProgress:p => heard.push(["progress", p]),
    onReady:() => heard.push(["ready"]),
    onFailed:() => heard.push(["failed"]),
    onReading:r => heard.push(["reading", r.id]),
    onMove:r => heard.push(["move", r.id]),
    createWorker:url => { const w = {url, posted:[], postMessage:m => w.posted.push(m), terminate() { w.ended = true; }}; made.push(w); return w; },
  });
  return {workers, made, heard, resize:s => { size = s; }};
}

test("最強 loads the network for the board once, reports progress and becomes ready", () => {
  const {workers, made, heard} = setup(9);
  workers.start(); workers.start();
  assert.equal(made.length, 1);
  assert.equal(made[0].url, "/katago-worker.bundle.mjs?net=kata9x9");
  made[0].onmessage({data:{kind:"progress", loaded:1, total:4}});
  made[0].onmessage({data:{kind:"availability", available:true}});
  assert.equal(workers.current().state, "ready");
  workers.requestMove(workers.current(), 7, {board:[]});
  assert.deepEqual(made[0].posted, [{id:7, kind:"move", state:{board:[]}, read:{one:2, two:6}}]);
  made[0].onmessage({data:{kind:"move", id:7}});
  assert.deepEqual(heard, [["progress", 25], ["ready"], ["move", 7]]);
});

test("a network that fails stops its worker, is not tried again, and only the current board's failure is announced", () => {
  const {workers, made, heard, resize} = setup(9);
  workers.start();
  resize(19);
  made[0].onerror({message:"boom"});
  assert.ok(made[0].ended);
  assert.deepEqual(heard, []);
  resize(9);
  workers.start();
  assert.equal(made.length, 1);
  assert.equal(workers.current().state, "failed");
});
