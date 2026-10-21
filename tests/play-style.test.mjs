import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,BLACK,WHITE} from "../public/core.mjs";
import {
  BALANCE,
  compatibility,
  FAR_REASON,
  LET_GO_REASON,
  MAX_POOLED,
  MIN_MOVES,
  pairShare,
  PLAY_STYLE_RE,
  playStyle,
  pooledPlayStyle,
  readResignReason,
  readStyleLink,
  readStyleMovesHash,
  reportPlayStyles,
  statPayload,
  styleLink,
  styleMoves,
  styleMovesHash,
  styleRanks,
  typeShare
} from "../public/play-style.mjs";
import {createHistoryStyle} from "../public/history-style.mjs";
import {installDom} from "./helpers/fake-dom.mjs";
import {renderStylePage} from "../scripts/build-html.mjs";
import {makeReviewUrl,makeStyleMovesPrompt} from "../public/sgf-link.mjs";
import {exportSGF} from "../public/sgf.mjs";
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

test("自由/律儀 reads how far quiet moves stand from the opponent's stones",()=>{
  const game=highAndLow();
  const black=playStyle(game,BLACK).score.shares[2],white=playStyle(game,WHITE).score.shares[2];
  assert.equal(white,FAR_REASON+10,"every White move touches a Black stone");
  assert.ok(black>FAR_REASON+30,"Black opens away from White's stones");
  const read=readStyleLink(styleLink(playStyle(game,WHITE)).replace(/^[^?]*/,""));
  assert.equal(read.evidence[2],FAR_REASON+10);
  const say=TEXT.playStyle.evidence[2];
  assert.equal(say({apart:1}),"序盤〜中盤の手が、相手の石から平均1.0路");
  assert.equal(say(65),"相手の手から2路以内への応手が65%","a link made before still reads");
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
  assert.deepEqual(readStyleLink("?t=AHFT"),{type:"AHFT",color:null,leans:null,ranks:null,evidence:null,games:1,partner:null});
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
  assert.deepEqual(local.sides.map(chip=>[chip.children[0].className,chip.textContent]),
    [["stone-mark","黒番"],["stone-mark white","白番"]],"each side shows a drawn stone, not ● or ○");
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

test("letting weak stones go early is 潔い, reaching for them till they are gone 粘り強い",()=>{
  const at=(x,y)=>y*19+x;
  // White grows two lines on the top and bottom edges by turns, while Black plays in the middle.
  let game=newGame(true,{size:19});
  for(let i=0;i<12;i++){game=play(game,at(i,9)); game=play(game,at(i>>1,i%2 ? 18 : 0));}
  // Both lines look this far gone (Black's ownership) whenever White reaches for them.
  const recallFor=gone=>state=>state.board.map(v=>v===WHITE ? gone : 0);
  const clinging=playStyle(game,WHITE,{recall:recallFor(0.8)}),letting=playStyle(game,WHITE,{recall:recallFor(0.1)});
  assert.equal(clinging.type[3],"T","still reaching for them when 90% lost");
  assert.equal(letting.type[3],"Q","let go when 55% lost, sooner than most");
  assert.ok(clinging.score.grit>0.25 && letting.score.grit<-0.25);
  assert.equal(clinging.score.shares[3],LET_GO_REASON+90);
  assert.equal(letting.score.shares[3],LET_GO_REASON+55);
  assert.ok(styleRanks(clinging.score)[3]<=50 && styleRanks(letting.score)[3]<=50);
  const read=readStyleLink(styleLink(clinging).split("?")[1]);
  assert.equal(read.evidence[3],LET_GO_REASON+90);
  assert.equal(TEXT.playStyle.evidence[3]({letGo:90}),"弱くなった自分の石に、取られる見込み約90%まで手をかけた");
  // Without ownership there is nothing to read, and 引き際 stays where the rest left it.
  assert.equal(playStyle(game,WHITE).score.grit,0);
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
  // Black owns all but White's stones, which are not weak, so only the timing tells.
  const style=playStyle(game,WHITE,{recall:state=>state.board.map(v=>v===WHITE ? 0 : 1)});
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

test("two styles read together: every pair has something, and the link carries the partner",()=>{
  const types=Object.keys(TEXT.playStyle.types);
  for(const a of types)for(const b of types){
    const result=compatibility({type:a},{type:b});
    assert.ok(result.percent>=70 && result.percent<=99,a+b);
    assert.equal(result.relations.length,4);
    const key=result.headline.startsWith("differ") ? null : result.headline;
    assert.ok(key===null ? TEXT.playStyle.compat.headlines.differ[Number(result.headline.slice(6))] : TEXT.playStyle.compat.headlines[key],a+b);
    assert.ok(pairShare(a,b)>0);
  }
  assert.equal(compatibility({type:"AHFT"},{type:"AHFT"}).headline,"mirror");
  assert.equal(compatibility({type:"AHFT"},{type:"GLRQ"}).headline,"opposite");
  assert.equal(compatibility({type:"AHFT"},{type:"GHFT"}).headline,"differ0");
  assert.equal(compatibility({type:BALANCE},{type:"GHFT"}).headline,"balance");
  // Leaning further the same way reads closer than a bare type.
  assert.ok(compatibility({type:"AHFT",leans:[90,90,90,90]},{type:"AHFT",leans:[90,90,90,90]}).percent>
    compatibility({type:"AHFT"},{type:"AHFT"}).percent);
  const game=highAndLow(),black=playStyle(game,BLACK),white=playStyle(game,WHITE);
  const read=readStyleLink(styleLink(black,white).split("?")[1]);
  assert.equal(read.partner.type,white.type);
  assert.equal(read.partner.leans.length,4);
  assert.equal(readStyleLink("?t=AHFT&u=XXXX").partner,null,"an unknown partner is dropped");
});

test("あなたらしかった手: two moves apart that lean furthest towards the type, with a question for an AI",()=>{
  const game=highAndLow(),style=playStyle(game,BLACK);
  const picks=styleMoves(game,BLACK,style);
  assert.equal(picks.length,2);
  // Black's own moves, ten or more apart, high on the 4th line and far from White;
  // the first move, with no White stone to be far from, is not one.
  for(const pick of picks){
    assert.equal(game.moves[pick.step-1].color,BLACK);
    assert.ok(pick.step>1);
    assert.deepEqual(pick.reasons.map(r=>[r.axis,r.high]),[[1,true],[2,true]]);
  }
  assert.ok(Math.abs(picks[1].step-picks[0].step)>=10);
  // White answered each move next to it from the 3rd line.
  const white=styleMoves(game,WHITE,playStyle(game,WHITE));
  assert.ok(white.every(pick=>pick.reasons.some(r=>r.axis===2 && !r.high && r.far===1)));
  assert.equal(TEXT.playStyle.moves.reasons[2](white[0].reasons.find(r=>r.axis===2)),"相手の石に接する手");
  // Through fewer moves, only those are read; no style, no moves.
  assert.ok(styleMoves(game,BLACK,playStyle(game,BLACK,{through:24}),{through:24}).every(pick=>pick.step<=24));
  assert.deepEqual(styleMoves(game,BLACK,null),[]);
  // Each one's question carries its replay URL and the board before it, ◇ where it was played.
  const pick={...picks[1],rank:1,url:makeReviewUrl("https://miego.fun",{snapshot:game},picks[1].step)};
  assert.equal(new URL(pick.url).searchParams.get("move"),String(pick.step));
  const prompt=makeStyleMovesPrompt({type:style.type,color:"B"},[pick]);
  assert.ok(prompt.includes("私（黒番）の打ち方は「"+style.type+" "+TEXT.playStyle.types[style.type].name+"」"));
  assert.ok(prompt.includes(pick.url) && prompt.includes("2番目："+pick.step+"手目（序盤の4線の高い手・相手の石から"));
  assert.ok(prompt.includes("この手が、なぜこの棋風の私らしい"));
  assert.equal(prompt.match(/◇/g).length,2);
  assert.ok(makeStyleMovesPrompt({type:style.type,color:null,com:true},[pick]).startsWith("囲碁アプリMieGOの棋風診断で、COMの打ち方は"));
});

test("あなたらしかった手 leave out moves that only save stones in atari",()=>{
  // Black's 4th move (the 7th) escapes from the atari White's 3rd put it in.
  const at=(x,y)=>y*9+x;
  let state=newGame(true,{size:9});
  for(const point of [at(4,4),at(4,3),at(2,6),at(5,4),at(6,2),at(3,4),at(4,5)])state=play(state,point);
  for(let i=0;i<14;i++){
    const free=state.board.findIndex((v,p)=>v===0 && p>=54 && !state.board[p-1] && !state.board[p+1]);
    state=play(state,free<0 ? null : free);
  }
  // Read as high and near, the escape on the 4th line next to White would lead.
  const style={...playStyle(state,BLACK),type:"GHRQ"};
  const picks=styleMoves(state,BLACK,style);
  assert.equal(picks.length,2);
  assert.ok(picks.every(pick=>pick.step!==7));
});

test("the /style link carries あなたらしかった手 and the game in its fragment only",()=>{
  const game=highAndLow(),style=playStyle(game,BLACK),picks=styleMoves(game,BLACK,style);
  const sgf=exportSGF({snapshot:game}),hash=styleMovesHash(picks,sgf);
  assert.match(hash,/^#k=\d+_H4\.F4,\d+_H4\.F4&sgf=/);
  const read=readStyleMovesHash(hash);
  assert.equal(read.sgf,sgf);
  assert.equal(read.com,false);
  assert.deepEqual(read.picks.map(pick=>pick.step),picks.map(pick=>pick.step));
  assert.deepEqual(read.picks[0].reasons,picks[0].reasons.map(r=>({...r,attack:false,invasion:false,reinforcement:false,
    line:r.axis===1 ? r.line : null,far:r.axis===2 ? r.far : null})));
  const reasons=[{axis:0,high:true,attack:true,invasion:true},{axis:0,high:false,reinforcement:true},{axis:2,high:false,far:1}];
  const back=readStyleMovesHash(styleMovesHash([{step:5,reasons}],sgf,true));
  assert.equal(back.com,true);
  assert.deepEqual(back.picks[0].reasons.map(r=>[r.axis,r.high,r.attack,r.invasion,r.reinforcement,r.far]),
    [[0,true,true,true,false,null],[0,false,false,false,true,null],[2,false,false,false,false,1]]);
  assert.equal(styleMovesHash([],sgf),"");
  for(const bad of ["","#k=5_Z1&sgf=x","#k=0_H4&sgf=x","#k=5_H4"])assert.equal(readStyleMovesHash(bad),null);
  // The share sheet opens the page with them; the page shows them, and its link for a partner leaves them out.
  const share=readFileSync(new URL("../public/share-images.mjs",import.meta.url),"utf8");
  const page=readFileSync(new URL("../public/play-style-page.mjs",import.meta.url),"utf8");
  assert.match(share,/styleMovesHash\(picks,exportSGF\(\{snapshot,sgfMeta:metadata\}\),style\.com\)/);
  assert.match(share,/window\.open\(styleLink\(style\)\+\(style\.moves \?\? ""\),"_blank","noopener"\)/);
  assert.match(page,/readStyleMovesHash\(location\.hash\)/);
  assert.match(page,/const link = location\.href\.split\("#"\)\[0\];/);
});
