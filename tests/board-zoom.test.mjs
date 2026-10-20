import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {IDENTITY_VIEW,HINT_MIN_SIZE,clampView,pinchView,panView,zoomAround,maxScaleFor,
  createRepeatTapDetector} from "../public/board-zoom.mjs";

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} ≈ ${b}`);

test("zoomed views always cover the frame and near-1 scales snap to the full board",()=>{
  assert.equal(clampView({scale:1.02,x:-.01,y:0},3),IDENTITY_VIEW);
  assert.deepEqual(clampView({scale:9,x:-5,y:.4},3),{scale:3,x:-2,y:0});
  assert.deepEqual(clampView({scale:2,x:-.5,y:-.25},3),{scale:2,x:-.5,y:-.25});
});

test("pinching keeps the board point under the fingers' midpoint in place",()=>{
  const from=[{x:90,y:90},{x:110,y:110}], to=[{x:70,y:70},{x:130,y:130}];
  const view=pinchView(IDENTITY_VIEW,from,to,400,4);
  near(view.scale,3);
  // Board point .25 was under the midpoint (100px of 400px) and stays there.
  near(view.x+.25*view.scale,.25);
  near(view.y+.25*view.scale,.25);
});

test("two-finger and one-finger drags pan the zoomed board within bounds",()=>{
  const start={scale:2,x:-.5,y:-.5};
  const moved=pinchView(start,[{x:100,y:100},{x:140,y:100}],[{x:140,y:100},{x:180,y:100}],400,4);
  near(moved.scale,2);near(moved.x,-.4);near(moved.y,-.5);
  assert.deepEqual(panView(start,400,-800,400,4),{scale:2,x:0,y:-1});
});

test("trackpad zoom anchors at the pointer and larger boards allow deeper zoom",()=>{
  const view=zoomAround(IDENTITY_VIEW,2,.5,.5,3);
  assert.deepEqual(view,{scale:2,x:-.5,y:-.5});
  assert.equal(maxScaleFor(9),2);
  assert.ok(maxScaleFor(19)>3);
});

test("the hint fires only after repeated taps around one area",()=>{
  const detector=createRepeatTapDetector();
  assert.equal(detector.note(3,3,0),false);
  assert.equal(detector.note(15,15,500),false,"a far tap starts a new cluster");
  assert.equal(detector.note(14,15,900),false);
  assert.equal(detector.note(15,14,1300),true,"third nearby tap");
  assert.equal(detector.note(15,14,1400),false,"the cluster is consumed once it fires");
  const slow=createRepeatTapDetector();
  slow.note(5,5,0);slow.note(5,5,9000);
  assert.equal(slow.note(5,5,18000),false,"taps spread over time do not count");
  assert.equal(HINT_MIN_SIZE,13);
});

test("opponent moves return to the whole-board view and gesture clicks never place stones",()=>{
  const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
  // A watched COM同士 game is the exception: the viewer's zoom stays.
  assert.match(app,/if\(action\.type==="move" && \(remote \|\| isAiMove && !watching\)\)boardZoom\.reset\(\)/);
  assert.match(app,/apply\(\{type:"move",position,.*\},false,fromAi\)/);
  assert.match(app,/if\(boardZoom\.consumeGestureClick\(\)\)return;/);
});
