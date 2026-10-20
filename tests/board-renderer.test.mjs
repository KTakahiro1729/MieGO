import test from "node:test";
import assert from "node:assert/strict";
import {at,BLACK,boardHash,newGame,play,WHITE} from "../public/core.mjs";
import {BREATH_MS,BREATH_STEP_MS,BURST_MS,CAPTURE_FADE_MS} from "../public/board-renderer.mjs";
import {recordingBoard,baseView} from "./helpers/board-canvas.mjs";
import {ownershipPixel,countingOpacity} from "../public/territory-view.mjs";

test("replay ignores a provisional move and paints the replay marker",()=>{
  const game=newGame();
  const candidate=play(game,at(1,1));
  const replay=play(game,at(6,6));
  const view={...baseView(game),candidate,boardReview:{display:replay,ownership:null}};
  const {draw,calls}=recordingBoard(()=>view);
  draw();
  const stones=calls.filter(c=>c.kind==="arc"&&c.args[2]===22);
  assert.equal(stones.length,1);
  assert.deepEqual(stones[0].args.slice(0,2),[350,350]);
  assert.equal(stones[0].alpha,1);
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===26),false,"no dashed preview marker");
  assert.ok(calls.some(c=>c.kind==="arc"&&c.args[0]===350&&c.args[1]===350&&Math.abs(c.args[2]-14)<1e-9),"last-move ring");
});

test("forbidden points are unmarked until selected and draw a provisional stone without commits",()=>{
  const game=newGame();
  for(const p of [at(1,0),at(0,1),at(2,1),at(1,2)])game.board[p]=WHITE;
  game.history=[boardHash(game.board)];
  let illegalCandidate=null;
  const {draw,calls}=recordingBoard(()=>({...baseView(game),illegalCandidate}));
  draw();
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===9),false);
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===22&&c.args[0]===100&&c.args[1]===100),false);
  calls.length=0;
  illegalCandidate={position:at(1,1),reason:"suicide",source:game};
  draw();
  const stone=calls.find(c=>c.kind==="arc"&&c.args[2]===22&&c.args[0]===100&&c.args[1]===100);
  assert.equal(stone?.alpha,.68);
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===26&&c.args[0]===100),true);
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===9),false,"no board-wide forbidden markers");
  assert.equal(game.board[at(1,1)],0);
  calls.length=0;
  illegalCandidate=null;
  draw();
  assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===22&&c.args[0]===100&&c.args[1]===100),false);
});

test("ownership overlay uses preview-independent review values and hides with the none colour map",()=>{
  const game=newGame();
  let palette="mono";
  const boardReview={display:{...game},ownership:Array(81).fill(0)};
  boardReview.ownership[at(2,2)]=1;
  const view={...baseView(game),boardReview,displayedOwnership:Array(81).fill(-1)};
  const {draw,calls,overlay}=recordingBoard(()=>({...view,palette}));
  draw();
  assert.equal(calls.filter(c=>c.kind==="image").length,1);
  const alphaAt=(x,y)=>overlay.data[((y+1)*11+x+1)*4+3];
  assert.equal(alphaAt(0,0),0,"review neutral point should stay transparent");
  assert.ok(alphaAt(2,2)>0,"review ownership draws only its own field");
  calls.length=0;
  palette="none";
  draw();
  assert.equal(calls.filter(c=>c.kind==="image").length,0);
});

test("the overlay colours are the same on every board look",()=>{
  const game=newGame();
  let boardTheme;
  const fills=[];
  const ownership=Array(81).fill(1);
  const view={...baseView(game),displayedOwnership:ownership};
  const {draw,overlay}=recordingBoard(()=>({...view,boardTheme}));
  for(boardTheme of ["wood","light","dark","bogus"]){
    draw();
    fills.push(overlay.data.slice(12*4,12*4+4).join(","));
  }
  assert.equal(new Set(fills).size,1,"colours come from the map, not the board");
});

test("the estimate fades out past the outer lines instead of ending in a hard edge",()=>{
  const game=newGame();
  const view={...baseView(game),displayedOwnership:Array(81).fill(1)};
  const {draw,calls,overlay}=recordingBoard(()=>view);
  draw();
  const image=calls.find(c=>c.kind==="image");
  const gap=500/10;
  assert.deepEqual(image.args.slice(1),[gap/2-gap,gap/2-gap,gap*11,gap*11]);
  assert.equal(image.smoothing,true);
  for(let i=0;i<11;i++){
    assert.equal(overlay.data[i*4+3],0,"top ring is transparent");
    assert.equal(overlay.data[(10*11+i)*4+3],0,"bottom ring is transparent");
    assert.equal(overlay.data[(i*11)*4+3],0,"left ring is transparent");
    assert.equal(overlay.data[(i*11+10)*4+3],0,"right ring is transparent");
  }
  assert.ok(overlay.data[(11+1)*4+3]>0,"the corner point itself is coloured");
});

test("counting paints flat cells in the chosen colour map and rings neutral points",()=>{
  // Black owns the left five columns, White the right three; column 5 is neutral.
  const game={...newGame(),status:"scoring",board:Array(81).fill(0)};
  for(let y=0;y<9;y++){game.board[at(4,y)]=1;game.board[at(6,y)]=WHITE;}
  const view={...baseView(game),palette:"greenPurple",opacity:.2,boardTheme:"wood"};
  const {draw,calls,overlay}=recordingBoard(()=>view);
  draw();
  const pixel=i=>[...overlay.data.slice(i*4,i*4+4)];
  const black=ownershipPixel(1,"greenPurple",countingOpacity(.2),"wood");
  const white=ownershipPixel(-1,"greenPurple",countingOpacity(.2),"wood");
  assert.deepEqual(pixel(at(0,0)),black);
  assert.deepEqual(pixel(at(8,0)),white);
  assert.equal(pixel(at(5,0))[3],0,"neutral points stay uncoloured");
  const image=calls.find(c=>c.kind==="image");
  assert.equal(image.smoothing,false,"counted areas have hard edges");
  const rings=calls.filter(c=>c.kind==="arc" && Math.abs(c.args[2]-500/10*.13)<1e-9);
  assert.equal(rings.length,9,"one ring per neutral point");
  // Counting is never hidden: the none colour map falls back to the default.
  view.palette="none";draw();
  assert.deepEqual(pixel(at(0,0)),ownershipPixel(1,"mono",countingOpacity(.2),"wood"));
});

test("hidden stones leave only the ownership while playing and reappear when counting",()=>{
  let game=play(play(newGame(),at(2,2)),at(6,6));
  const ownership=Array(81).fill(.9);
  let candidate=null;
  const {draw,calls}=recordingBoard(()=>({...baseView(game),hideStones:true,displayedOwnership:ownership,candidate}));
  draw();
  assert.equal(calls.filter(c=>c.kind==="arc"&&c.args[2]===22).length,0,"no committed stones");
  assert.ok(calls.some(c=>c.kind==="image"),"ownership still painted");
  calls.length=0;
  candidate=play(game,at(4,4));
  draw();
  const shown=calls.filter(c=>c.kind==="arc"&&c.args[2]===22);
  assert.deepEqual(shown.map(c=>c.args.slice(0,2)),[[250,250]],"only the move being placed");
  calls.length=0;
  candidate=null;
  game={...game,status:"scoring",dead:[]};
  draw();
  assert.equal(calls.filter(c=>c.kind==="arc"&&c.args[2]===22).length,2,"counting shows the stones");
});

test("a provisional capture stays translucent until confirmed, and cancelling restores it",()=>{
  const game=newGame();
  game.board[at(1,1)]=WHITE;
  for(const p of [at(1,0),at(0,1),at(2,1)])game.board[p]=1;
  game.history=[boardHash(game.board)];
  const committed=play(game,at(1,2));
  let candidate=committed,boardReview=null;
  const {draw,calls}=recordingBoard(()=>({...baseView(game),boardReview,candidate}));
  const stone=(x,y)=>calls.find(c=>c.kind==="arc"&&c.args[2]===22&&c.args[0]===x&&c.args[1]===y);
  draw();
  assert.equal(stone(100,100)?.alpha,.4,"captured stone is translucent before confirmation");
  assert.equal(stone(100,150)?.alpha,.68,"preview stone retains its distinct alpha");
  assert.equal(stone(100,50)?.alpha,1,"untouched stones remain opaque");
  calls.length=0;
  boardReview={display:committed,ownership:null}; // replay uses the committed position only
  draw();
  assert.equal(stone(100,100),undefined,"replay does not paint a captured stone");
  calls.length=0;
  boardReview=null;
  candidate=null; // cancellation restores the original full-opacity stone
  draw();
  assert.equal(stone(100,100)?.alpha,1);
  assert.equal(stone(100,150),undefined);
});

test("a move's captured stones fade out instead of vanishing, unless motion is reduced",()=>{
  let game=newGame();
  for(const p of [at(1,0),at(0,1),at(2,1)])game.board[p]=BLACK;
  game.board[at(1,1)]=WHITE;
  game.history=[boardHash(game.board)];
  const captured=([x,y])=>x===100&&y===100;
  for(const still of [false,true]){
    let time=0,frames=[];
    let shown=game;
    const {draw,calls}=recordingBoard(()=>baseView(shown),{
      requestFrame:f=>frames.push(f),now:()=>time,stillMotion:()=>still});
    draw();
    shown=play(game,at(1,2));
    calls.length=0;draw();
    const ghost=calls.find(c=>c.kind==="arc"&&c.args[2]===22&&captured(c.args));
    if(still){assert.equal(ghost,undefined);assert.equal(frames.length,0);continue;}
    assert.equal(ghost?.alpha,1);
    assert.equal(frames.length,1,"asks for the next frame");
    time=CAPTURE_FADE_MS/2;calls.length=0;frames.shift()();
    assert.equal(calls.find(c=>c.kind==="arc"&&c.args[2]===22&&captured(c.args))?.alpha,.5);
    time=CAPTURE_FADE_MS;calls.length=0;frames.shift()();
    assert.equal(calls.some(c=>c.kind==="arc"&&c.args[2]===22&&captured(c.args)),false);
    assert.equal(frames.length,0,"stops once faded");
  }
});

test("ドパガキモード sends sparks out of a taken stone, none when off or with motion reduced",()=>{
  let game=newGame();
  for(const p of [at(1,0),at(0,1),at(2,1)])game.board[p]=BLACK;
  game.board[at(1,1)]=WHITE;
  game.history=[boardHash(game.board)];
  // A spark starts at gap*.09 (4.5 on this 50-wide grid); a star point is 4.
  const sparks=(calls,r)=>calls.filter(c=>c.kind==="arc"&&Math.abs(c.args[2]-r)<1e-9).length;
  for(const [burst,still,expected] of [["off",false,0],["on",false,7],["ultra",false,12],["ultra",true,0]]){
    let time=0,frames=[],shown=game;
    const {draw,calls}=recordingBoard(()=>({...baseView(shown),burst}),{
      requestFrame:f=>frames.push(f),now:()=>time,stillMotion:()=>still,random:()=>.5});
    draw();
    shown=play(game,at(1,2));
    calls.length=0;draw();
    assert.equal(sparks(calls,4.5),expected,burst);
    if(!expected)continue;
    time=BURST_MS/2;calls.length=0;frames.shift()();
    assert.equal(sparks(calls,3.375),expected,"they shrink as they fly");
    time=BURST_MS;calls.length=0;
    while(frames.length)frames.shift()();
    assert.equal(sparks(calls,4.5)+sparks(calls,3.375),0);
    assert.equal(frames.length,0,"stops once they are gone");
  }
});

test("an empty board shows sample stones only while its colours are edited",()=>{
  const game=newGame();
  let sampleStones=false;
  const {draw,calls}=recordingBoard(()=>({...baseView(game),sampleStones}));
  const stones=()=>calls.filter(c=>c.kind==="arc"&&c.args[2]===22);
  draw();
  assert.equal(stones().length,0);
  sampleStones=true;
  draw();
  assert.equal(stones().length,5);
  assert.ok(calls.some(c=>c.kind==="arc"&&Math.abs(c.args[2]-14)<1e-9),"one carries the last-move ring");
  assert.equal(game.board.some(Boolean),false,"the game never holds them");
  calls.length=0;
  const played=play(game,at(2,2));
  const {draw:drawPlayed,calls:playedCalls}=recordingBoard(()=>({...baseView(played),sampleStones:true}));
  drawPlayed();
  assert.equal(playedCalls.filter(c=>c.kind==="arc"&&c.args[2]===22).length,1,"a board with stones shows only its own");
});

test("盤の線 runs still dashes through each group and out to a dot on each liberty",()=>{
  const game=newGame();
  game.board[at(4,4)]=BLACK;game.board[at(5,4)]=BLACK;game.board[at(4,5)]=WHITE;
  const frames=[];
  const {draw,calls}=recordingBoard(()=>({...baseView(game),linkStones:"lines"}),{requestFrame:f=>frames.push(f),stillMotion:()=>true});
  draw();
  const ends=calls.filter(c=>c.kind==="line").map(c=>c.args.join(","));
  assert.ok(ends.includes(String([250,200+6.5])),"from the stone up to the dot on the empty point above");
  assert.ok(calls.some(c=>c.kind==="arc"&&c.args[0]===250&&c.args[1]===200&&c.args[2]===6.5),"the dot");
  // (5,5) is needed by a black stone and a white one: half a dot each.
  assert.equal(calls.filter(c=>c.kind==="arc"&&c.args[0]===300&&c.args[1]===300&&c.args[2]===6.5).length,2);
  assert.equal(ends.some(e=>{const [x,y]=e.split(",").map(Number);return x===250&&y>250&&y<300;}),false,"nothing between black and white");
  assert.equal(frames.length,0,"still where motion is reduced");
});

test("盤の線 sends a breath over the dashes from the liberties, only to the stone's edge in atari",()=>{
  const game=newGame();
  // Black (0,0)-(1,0) with three liberties; white (8,8) in atari, its one liberty (8,7).
  game.board[at(0,0)]=BLACK;game.board[at(1,0)]=BLACK;
  game.board[at(8,8)]=WHITE;game.board[at(7,8)]=BLACK;
  const frames=[];
  let time=BREATH_STEP_MS*3.5;
  const {draw,calls}=recordingBoard(()=>({...baseView(game),linkStones:"lines"}),
    {requestFrame:f=>frames.push(f),now:()=>time,stillMotion:()=>false});
  const lines=()=>{calls.length=0;draw();return calls.filter(c=>c.kind==="line").map(c=>c.args.join(","));};
  // Long after the last breath passed: the dashes alone.
  const dashes=lines();
  assert.equal(frames.length,1,"keeps breathing");
  const breath=at=>{time=BREATH_MS+BREATH_STEP_MS*at;return lines().filter(e=>!dashes.includes(e)).map(e=>e.split(",").map(Number));};
  // Half a line in, the breath runs from the dots toward the stones.
  assert.ok(breath(.5).some(([x,y])=>x===50&&y===75),"from the dot below (0,0)");
  // A line and a half in, it has passed through to the line between the stones.
  assert.ok(breath(1.5).some(([x,y])=>x===75&&y===50));
  // In atari it never gets past the white stone's edge, and is gone sooner.
  const white=breath(.5).concat(breath(1)).filter(([x,y])=>x===450&&y>400);
  assert.ok(white.length && white.every(([,y])=>y<=450-22+1e-9),"the white stone in atari only to its edge");
  assert.equal(breath(1.7).some(([x,y])=>x===450&&y>400),false);
});
