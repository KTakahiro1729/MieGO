import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,BLACK,WHITE} from "../public/core.mjs";
import {
  BALANCE,
  MAX_POOLED,
  MIN_MOVES,
  PLAY_STYLE_RE,
  playStyle,
  readResignReason,
  pooledPlayStyle,
  readStyleLink,
  reportPlayStyles,
  statPayload,
  styleLink,
  styleRanks,
  typeShare
} from "../public/play-style.mjs";
import {createHistoryStyle} from "../public/history-style.mjs";
import {installDom} from "./helpers/fake-dom.mjs";
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

test("every one of the 17 types has a short name",()=>{
  const types=[BALANCE];
  for(const a of "AG")for(const b of "HL")for(const c of "FR")for(const d of "TQ")types.push(a+b+c+d);
  assert.deepEqual(Object.keys(TEXT.playStyle.types).sort(),types.sort());
  assert.equal(new Set(Object.values(TEXT.playStyle.types).map(t=>t.name)).size,17);
  assert.ok(types.every(type=>PLAY_STYLE_RE.test(type)));
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
  // Resigned with no ownership kept: 潔い, with both timings unknown.
  assert.match(link,/^\/style\?t=.LRQ&c=W&s=-?\d+,-?\d+,-?\d+,-75&p=\d+,\d+,\d+,\d+&e=\d+,\d+,\d+,-1$/);
  const read=readStyleLink(link.slice(link.indexOf("?")));
  assert.equal(read.type,style.type);
  assert.equal(read.color,"W");
  assert.equal(read.leans.length,4);
  assert.ok(read.ranks.every(v=>v>=1 && v<=50),"where the player stands among people");
  assert.equal(read.evidence[3],-1,"resigned");
  assert.ok(read.leans.every(v=>Math.abs(v)<=100));
  assert.deepEqual(readStyleLink("?t=AHFT"),{type:"AHFT",color:null,leans:null,ranks:null,evidence:null,games:1});
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

test("whoever passes first lets go first (潔い); the other kept going (粘り強い)",()=>{
  let game=highAndLow();
  // The same moves without the resignation, ended by White passing first.
  game={...game,moves:game.moves.slice(0,-1)};
  let state=newGame(true,{size:19});
  for(const m of game.moves)state=play(state,m.position);
  state=play(state,null);
  assert.equal(playStyle(state,WHITE).type[3],"Q");
  assert.equal(playStyle(state,BLACK).type[3],"T");
});

test("several games read together give one style, leaving out games too short to read",()=>{
  const game=highAndLow(),short={...game,moves:game.moves.slice(0,6)};
  const one=playStyle(game,BLACK);
  const pooled=pooledPlayStyle([{snapshot:game,color:BLACK},{snapshot:game,color:BLACK},{snapshot:short,color:BLACK}]);
  assert.equal(pooled.games,2);
  assert.equal(pooled.type,one.type);
  assert.deepEqual(pooled.score,one.score,"the same game twice reads as once");
  // 引き際 is a mean over games: one resigned and one played on is neither.
  const mixed=pooledPlayStyle([{snapshot:game,color:WHITE},{snapshot:game,color:BLACK}]);
  assert.ok(mixed.score.grit>-1 && mixed.score.grit<1);
  assert.equal(pooledPlayStyle([{snapshot:short,color:BLACK}]),null);
  // The page says how many games it read.
  const link=styleLink(pooled);
  assert.match(link,/&n=2$/);
  assert.equal(readStyleLink(link.slice(link.indexOf("?"))).games,2);
  assert.equal(readStyleLink("?t=AHFT&n="+(MAX_POOLED+1)).games,1);
  assert.equal(readStyleLink("?t=AHFT").games,1);
  assert.doesNotMatch(styleLink(one),/&n=/);
});

test("in 履歴, the person's own side in recent games is picked and can be changed",t=>{
  const dom=installDom({width:390,height:844});
  t.after(dom.restore);
  for(const id of ["historyStyle","historyStyleCancel","historyStyleOpen"])dom.document.add("button",id);
  dom.document.add("div","historyStyleBar").hidden=true;
  dom.document.add("p","historyStyleResult");
  const game=highAndLow();
  const records=[
    {id:"com-game",mode:"ai",humanColor:WHITE,snapshot:game},
    {id:"watched",mode:"ai",watch:true,humanColor:BLACK,snapshot:game},
    {id:"one-device",mode:"local",snapshot:game},
  ];
  const opened=[];
  const style=createHistoryStyle({$:dom.$,gameLibrary:{list:()=>records},
    ownSide:record=>record.mode==="ai" ? record.humanColor : null,open:url=>opened.push(url)});
  const rows=()=>records.map(record=>{
    const row=dom.document.createElement("div"),item=dom.document.createElement("button");
    row.append(item);style.decorateRow(row,record,item);
    const group=row.children[1];
    return {row,item,label:group?.children[0]?.textContent,
      sides:[...group?.children ?? []].filter(el=>el.className==="history-style-side")};
  });
  assert.equal(rows()[0].sides.length,0,"nothing is added until picking starts");
  dom.$("historyStyle").click();
  assert.equal(dom.$("historyStyleBar").hidden,false);
  let [com,watched,local]=rows();
  assert.deepEqual(com.sides.map(chip=>chip.getAttribute("aria-pressed")),["true"],"only the COM game's own side, picked");
  assert.equal(watched.sides.length,0,"a watched game has no side of theirs");
  assert.ok(watched.row.classList.contains("is-unreadable"),"hidden while picking");
  assert.equal(local.label,"自分の石","the side buttons say what they pick");
  assert.deepEqual(local.sides.map(chip=>chip.getAttribute("aria-pressed")),["false","false"],"either side may be theirs");
  const white=playStyle(game,WHITE);
  assert.match(dom.$("historyStyleResult").textContent,new RegExp("^"+white.type+" .*1局"));
  local.sides[1].click();
  [com,watched,local]=rows();
  assert.equal(local.sides[1].getAttribute("aria-pressed"),"true");
  assert.match(dom.$("historyStyleResult").textContent,/2局/);
  dom.$("historyStyleOpen").click();
  assert.match(opened[0],/^\/style\?t=[AG]LRQ&s=.*&n=2$/);
  // Tapping a picked row's own button lets it go.
  com.item.click();
  assert.match(dom.$("historyStyleResult").textContent,/1局/);
  dom.$("historyStyleCancel").click();
  assert.equal(dom.$("historyStyleBar").hidden,true);
  assert.equal(rows()[0].sides.length,0);
});

test("each way to 棋風診断 leads on to the others",async()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
  const page=await renderStylePage();
  // The share sheet keeps its 棋風診断 section, so 履歴's reading is reached even before a game has a type.
  assert.match(html,/<section id="sharePlayStyles" class="settings-section">[\s\S]*?id="sharePlayStyleMore"/);
  assert.match(app,/\$\("sharePlayStyleMore"\)\.onclick=openHistoryStyle;/);
  // The /style page links back to 履歴's reading, which the app opens from the address.
  assert.match(page,/href="\/\?open=history-style"/);
  assert.match(app,/params\.get\("open"\)==="history-style"/);
  // A finished game of 囲碁 opens the share sheet at its 棋風診断.
  assert.match(html,/<div id="scoreBox"[\s\S]*?id="scoreStyle"/);
  assert.match(app,/\$\("scoreStyle"\)\.onclick=\(\)=>\{openSharePanel\(\);\$\("sharePlayStyles"\)\.scrollIntoView/);
  // A watched COM同士 game shows both COMs' types (after the game and in the share sheet), uncounted.
  assert.match(app,/return \{played:\[\],watched:\[BLACK,WHITE\]\};/);
  assert.match(app,/\[\.\.\.playedSides\(\),\.\.\.watchedSides\(\)\]\.some\(color=>canReadStyle\(game,color\)\)/);
  const share=readFileSync(new URL("../public/share-images.mjs",import.meta.url),"utf8");
  assert.match(share,/reportPlayStyles\([^;]*,styles\);\s*const watched=watchedSides\(\)/);
  // Read together, a type's text no longer speaks of one game.
  for(const {text} of Object.values(TEXT.playStyle.types))
    assert.doesNotMatch(TEXT.playStyle.pooledText(text),/この一局/);
});

test("引き際 has a rank among people only where people were measured",()=>{
  const game=highAndLow(),black=playStyle(game,BLACK);
  // Black won by resignation: 粘り強い with nothing to compare.
  assert.equal(black.type[3],"T");
  assert.equal(styleRanks(black.score)[3],null);
  const link=styleLink(black);
  assert.match(link,/&p=\d+,\d+,\d+,&/);
  assert.deepEqual(readStyleLink(link.split("?")[1]).ranks.slice(3),[null]);
  assert.equal(readStyleLink("?t=AHFT&p=,,,").ranks,null,"no rank at all reads as none");
});

test("a resignation is the more 潔い the closer the game and the sooner after it was lost",()=>{
  const game=highAndLow(),size=game.board.length;
  const even=Array(size).fill(0),black=Array(size).fill(0.5);
  // About even (komi aside) at resigning, the earliest kind.
  const close=playStyle(game,WHITE,{recall:()=>even});
  // Far behind from the 10th move on: White played 5 more moves before resigning.
  const turned=playStyle(game,WHITE,{recall:state=>state.moves.length<10 ? even : black});
  // Far behind from the first move.
  const lost=playStyle(game,WHITE,{recall:()=>black});
  assert.equal(close.score.grit,-1);
  assert.equal(turned.score.grit,-1+(1+5/45)/4);
  assert.equal(lost.score.grit,-1+(1+10/45)/4);
  for(const style of [close,turned,lost])assert.equal(style.type[3],"Q");
  const ranks=[close,turned,lost].map(style=>styleRanks(style.score)[3]);
  assert.ok(ranks[0]<ranks[1] && ranks[1]<=ranks[2],"the earlier resignation is the rarer");
  // The page is told how far behind and how many moves after falling far behind.
  assert.deepEqual(readResignReason(close.score.shares[3]),{deficit:0,late:0});
  assert.deepEqual(readResignReason(turned.score.shares[3]),{deficit:173,late:5});
  assert.deepEqual(readResignReason(lost.score.shares[3]),{deficit:173,late:10});
  assert.deepEqual(readResignReason(-1),{deficit:null,late:null});
  const read=readStyleLink(styleLink(turned).split("?")[1]);
  assert.equal(read.evidence[3],turned.score.shares[3]);
  const say=TEXT.playStyle.evidence[3];
  assert.equal(say(readResignReason(turned.score.shares[3])),"形勢 約173目差で投了（大差がついてから5手後）");
  assert.equal(say(readResignReason(close.score.shares[3])),"形勢 約0目差で投了（大差がつく前）");
  assert.equal(say({deficit:null,late:null}),"投了で対局を終えた");
  assert.equal(say(30),"10目以上負けている局面の30%でも打ち続けた");
});

test("a resignation's timing is scaled to 19路 by board area",()=>{
  // The same moves on 9路 are far behind sooner: 20 points on 19路 is about 4.5 on 9路.
  const at=(x,y)=>y*9+x;
  let state=newGame(true,{size:9});
  for(let i=0;i<12;i++){state=play(state,at(i%9,Math.floor(i/9)*4)); state=play(state,at(i%9,Math.floor(i/9)*4+2));}
  const game=play(play(state,at(8,8)),"resign");
  const black=Array(81).fill(0.5);
  const style=playStyle(game,WHITE,{recall:()=>black});
  // 12 own moves on 9路 count as 12*361/81, past LATE_MOVES; the deficit past DEFICIT_LATE as well.
  assert.equal(style.score.grit,-0.5);
  assert.equal(readResignReason(style.score.shares[3]).late,12);
});

test("the balanced type and every type's share of people",()=>{
  const types=Object.keys(TEXT.playStyle.types);
  assert.ok(types.every(type=>typeShare(type)>0));
  const total=types.reduce((sum,type)=>sum+typeShare(type),0);
  assert.ok(Math.abs(total-100)<1,"the types' shares make up everyone");
  assert.deepEqual(readStyleLink("?t="+BALANCE+"&s=0,0,0,0").leans,[0,0,0,0]);
});
