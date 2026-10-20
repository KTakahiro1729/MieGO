import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at,isGomoku,rulesOf,toSGF,BLACK,WHITE} from "../public/core.mjs";
import {gomokuMove,makesFive,winningLine} from "../public/gomoku.mjs";
import {replaySteps,parseSGF,exportSGF} from "../public/sgf.mjs";
import {takeBack} from "../public/takeback.mjs";
import {reconcileGame} from "../public/p2p-session.mjs";
import {resultLabel} from "../public/result-label.mjs";
import {TEXT} from "../public/texts.mjs";

const line=(game,moves)=>moves.reduce((state,[x,y])=>play(state,at(x,y,13)),game);

test("五目並べ is a ruleset of its own, with no handicap or hidden stones",()=>{
  const game=newGame(true,{size:13,rules:"gomoku",handicap:4,hideStones:true});
  assert.equal(isGomoku(game),true);
  assert.equal(rulesOf(game),"gomoku");
  assert.equal(game.handicap,0);
  assert.equal(game.next,BLACK);
  assert.equal(Object.hasOwn(game,"hideStones"),false);
  assert.ok(game.board.every(stone=>stone===0));
  assert.equal(isGomoku(newGame()),false);
});

test("five in a row wins, and an overline wins too (free-style)",()=>{
  const black=[[0,0],[1,0],[2,0],[3,0]],white=[[0,5],[1,5],[2,5],[3,5]];
  let game=newGame(true,{size:13,rules:"gomoku"});
  for(let i=0;i<4;i++)game=line(game,[black[i],white[i]]);
  assert.equal(game.status,"playing");
  game=line(game,[[4,0]]);
  assert.equal(game.status,"finished");
  assert.equal(game.result,"B+");
  assert.deepEqual(winningLine(game.board,at(4,0,13)),[0,1,2,3,4].map(x=>at(x,0,13)));
  assert.throws(()=>play(game,at(6,6,13)),/Not playing/);
  // Six in a row, made by filling the gap, also wins.
  let six=newGame(true,{size:13,rules:"gomoku"});
  six=line(six,[[0,2],[0,8],[1,2],[1,8],[2,2],[2,8],[4,2],[3,9],[5,2],[4,9]]);
  six=line(six,[[3,2]]);
  assert.equal(six.result,"B+");
  assert.equal(makesFive(six.board,at(3,2,13)),true);
  assert.equal(resultLabel("W+"),TEXT.result.win("W"));
});

test("nothing is captured, there is no pass, and a full board is a draw",()=>{
  let game=newGame(true,{size:9,rules:"gomoku"});
  // A white stone surrounded by black stays on the board.
  game=line(game,[]);
  for(const [p,q] of [[at(4,3),at(4,4)],[at(3,4),at(0,8)],[at(5,4),at(8,0)],[at(4,5),at(8,8)]])
    game=play(play(game,p),q);
  assert.equal(game.board[at(4,4)],WHITE);
  assert.throws(()=>play(game,null));
  assert.throws(()=>play(game,at(4,4)),{message:TEXT.rules.occupied});
  // Fill a 9x9 board in a pattern with no five in a row: draw.
  let full=newGame(true,{size:9,rules:"gomoku"});
  const colorAt=(x,y)=>((Math.floor(x/2)+y)%2===0)?BLACK:WHITE;
  const blacks=[],whites=[];
  for(let y=0;y<9;y++)for(let x=0;x<9;x++)(colorAt(x,y)===BLACK?blacks:whites).push(at(x,y));
  assert.equal(blacks.length,whites.length+1);
  for(let i=0;i<blacks.length;i++){
    full=play(full,blacks[i]);
    if(full.status!=="playing")break;
    if(whites[i]!==undefined)full=play(full,whites[i]);
  }
  assert.equal(full.status,"finished");
  assert.equal(full.result,"0");
  assert.equal(resultLabel(full.result),TEXT.result.draw);
});

test("replays, 待った, SGF and a friend's first board keep 五目並べ",()=>{
  let game=line(newGame(true,{size:13,rules:"gomoku"}),[[6,6],[7,7],[6,7]]);
  assert.equal(isGomoku(replaySteps(game,2)),true);
  assert.equal(isGomoku(takeBack(game,{scope:"ply"}).game),true);
  const sgf=exportSGF(game);
  assert.match(sgf,/^\(;GM\[4\]FF\[4\]CA\[UTF-8\]SZ\[13\];B/);
  assert.doesNotMatch(sgf,/KM\[|RU\[/);
  assert.match(toSGF(game),/^\(;GM\[4\]/);
  const parsed=parseSGF(sgf);
  assert.equal(isGomoku(parsed.snapshot),true);
  assert.equal(parsed.snapshot.moves.length,3);
  assert.throws(()=>parseSGF("(;GM[4]FF[4]SZ[13]AB[gg];W[hh])"),{message:TEXT.sgf.setupGomoku});
  assert.throws(()=>parseSGF("(;GM[2]FF[4]SZ[9])"),{message:TEXT.sgf.notGo});
  // Before the first move, the inviter's 五目並べ replaces a guest's Go board.
  const guest=newGame(true,{size:13});
  const owner=newGame(true,{size:13,rules:"gomoku"});
  assert.equal(reconcileGame(guest,0,owner,0).kind,"adopt");
});

test("the computer takes a win, blocks a four, and opens in the centre",()=>{
  const empty=newGame(true,{size:13,rules:"gomoku"});
  assert.equal(gomokuMove(empty.board,BLACK),at(6,6,13));
  // Black has four in a row with an open end: White must block, Black must win.
  const board=[...empty.board];
  for(const x of [3,4,5,6])board[at(x,6,13)]=BLACK;
  for(const x of [3,4,5])board[at(x,8,13)]=WHITE;
  board[at(2,6,13)]=WHITE;
  assert.equal(gomokuMove(board,BLACK),at(7,6,13));
  assert.equal(gomokuMove(board,WHITE),at(7,6,13));
  // Its own five comes before blocking the opponent's.
  board[at(6,8,13)]=WHITE;
  const win=gomokuMove(board,WHITE),after=[...board];after[win]=WHITE;
  assert.equal(makesFive(after,win),true);
});

test("the current rules show above the board and open the rules help",()=>{
  assert.equal(TEXT.game.ruleLabel(9,"chinese",7.5,0),"9路 · 中国式 · コミ7.5");
  assert.equal(TEXT.game.ruleLabel(19,"japanese",0.5,3),"19路 · 日本式 · 置き石3");
  assert.equal(TEXT.game.ruleLabel(13,"gomoku",0,0),"13路 · 五目並べ");
  assert.match(TEXT.game.ruleSummary(13,0,0,"gomoku"),/五目並べ/);
});

test("五目並べ follows the UX policy: same action row, no new button kind",async()=>{
  const {readFileSync}=await import("node:fs");
  const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  // パス is greyed out in place, not removed, so the buttons do not move.
  assert.match(app,/if\(gomoku\)\$\("pass"\)\.disabled=true;/);
  assert.doesNotMatch(app,/if\(gomoku\)\$\("pass"\)\.hidden/);
  // The rules choice lives in the 新規対戦 sheet, not in the header.
  assert.match(html,/name="gameRules" value="gomoku"/);
  const header=html.slice(html.indexOf('<header class="topbar">'),html.indexOf("</header>"));
  assert.doesNotMatch(header,/gomoku|ruleLabel/);
  // The rule display is text, not a button.
  assert.doesNotMatch(html,/<button[^>]*id="ruleLabel"/);
});
