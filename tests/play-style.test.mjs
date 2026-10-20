import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,BLACK,WHITE} from "../public/core.mjs";
import {playStyle,statPayload,reportPlayStyles,MIN_MOVES,styleLink,readStyleLink} from "../public/play-style.mjs";
import {renderStylePage} from "../scripts/build-html.mjs";
import {readFileSync} from "node:fs";
import {TEXT} from "../public/texts.mjs";

// Black opens high on the 4th line, each move far from White's last; White
// answers every move from the 3rd line, right next to it, then resigns.
function highAndLow() {
  const at=(x,y)=>y*19+x;
  const black=[[3,3],[15,3],[15,15],[3,15],[9,3],[9,15],[3,9],[15,9],[3,12],[15,6]];
  const under=([x,y])=>x===3 ? [2,y] : x===15 ? [16,y] : y===3 ? [x,2] : [x,16];
  let state=newGame(true,{size:19});
  for(const point of black){
    state=play(state,at(...point));
    state=play(state,at(...under(point)));
  }
  return play(play(state,at(9,9)),"resign");
}

test("each player's style is read from their own moves",()=>{
  const game=highAndLow();
  const black=playStyle(game,BLACK),white=playStyle(game,WHITE);
  assert.equal(black.color,"B");
  assert.equal(white.color,"W");
  assert.match(black.type,/^.HF.$/,"high, and away from the opponent's last move");
  assert.match(white.type,/^.LRQ$/,"low, next to the last move, and resigned");
  assert.equal(black.type[3],"T","the side that did not let go");
  for(const {type} of [black,white])assert.ok(TEXT.playStyle.types[type],"every type has a name");
});

test("there is no style for too few moves, 五目並べ or a free board",()=>{
  const game=highAndLow();
  assert.equal(playStyle(game,BLACK,{through:2*(MIN_MOVES-1)}),null);
  assert.ok(playStyle(game,BLACK,{through:2*MIN_MOVES}));
  assert.equal(playStyle({...game,rules:"gomoku"},BLACK),null);
  assert.equal(playStyle({...game,rules:"free"},BLACK),null);
});

test("the resignation right after the shown moves counts",()=>{
  const game=highAndLow(),shown=game.moves.length-1;
  assert.equal(playStyle(game,WHITE,{through:shown}).type[3],"Q");
});

test("every one of the 16 types has a short name",()=>{
  const types=[];
  for(const a of "AG")for(const b of "HL")for(const c of "FR")for(const d of "TQ")types.push(a+b+c+d);
  assert.deepEqual(Object.keys(TEXT.playStyle.types).sort(),types.sort());
  assert.equal(new Set(Object.values(TEXT.playStyle.types).map(t=>t.name)).size,16);
});

test("a shown style is counted once, by type, board size and rules only",()=>{
  const game=highAndLow(),styles=[playStyle(game,BLACK),playStyle(game,WHITE)];
  assert.deepEqual(statPayload(game,styles),{size:19,rules:"chinese",
    styles:styles.map(({color,type})=>({color,type}))});
  const sent=[];
  const send=(url,body)=>{sent.push([url,body]);return true;};
  assert.equal(reportPlayStyles("g:21",game,styles,send),true);
  assert.equal(reportPlayStyles("g:21",game,styles,send),false,"the same position is not counted again");
  assert.equal(reportPlayStyles("g:20",game,[],send),false,"nothing shown, nothing sent");
  assert.equal(sent.length,1);
  assert.equal(sent[0][0],"/api/stat");
});

test("a player's /style link carries the type, colour and how far each axis leans",()=>{
  const style=playStyle(highAndLow(),WHITE),link=styleLink(style);
  assert.match(link,/^\/style\?t=.LRQ&c=W&s=-?\d+,-?\d+,-?\d+,-100$/);
  const read=readStyleLink(link.slice(link.indexOf("?")));
  assert.equal(read.type,style.type);
  assert.equal(read.color,"W");
  assert.equal(read.leans.length,4);
  assert.ok(read.leans.every(v=>Math.abs(v)<=100));
  assert.deepEqual(readStyleLink("?t=AHFT"),{type:"AHFT",color:null,leans:null});
  assert.equal(readStyleLink("?t=XXXX"),null);
  assert.equal(readStyleLink("?t=AHFT&s=1,2,3,999").leans,null,"out-of-range leanings are dropped");
});

test("the /style page is rendered from its template and texts.mjs",async()=>{
  const html=await renderStylePage();
  assert.equal(readFileSync(new URL("../public/style.html",import.meta.url),"utf8"),html,"run: node scripts/build-html.mjs");
  assert.match(html,/<title>MieGO 棋風診断<\/title>/);
  assert.match(html,/src="\/play-style-page\.mjs"/);
  assert.ok(!/\{\{/.test(html));
});
