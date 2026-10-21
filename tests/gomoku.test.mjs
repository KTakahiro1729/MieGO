import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play,at,isGomoku,hasGomokuForbidden,initialGame,rulesOf,BLACK,WHITE} from "../public/core.mjs";
import {forbiddenReason,makesFive,winningLine} from "../public/gomoku.mjs";
import {GOMOKU_LEVELS,gomokuMove} from "../public/gomoku-ai.mjs";
import {inspectProvisionalMove,forbiddenLines,forbiddenMessage} from "../public/illegal-moves.mjs";
import {replaySteps,parseSGF,exportSGF} from "../public/sgf.mjs";
import {takeBack} from "../public/takeback.mjs";
import {reconcileGame} from "../public/p2p-session.mjs";
import {resultLabel} from "../public/result-label.mjs";
import {TEXT} from "../public/texts.mjs";

const line=(game,moves)=>moves.reduce((state,[x,y])=>play(state,at(x,y,13)),game);

test("五目並べ is a ruleset of its own, with no handicap but with 石を隠す",()=>{
  const game=newGame(true,{size:13,rules:"gomoku",handicap:4,hideStones:true});
  assert.equal(isGomoku(game),true);
  assert.equal(rulesOf(game),"gomoku");
  assert.equal(game.handicap,0);
  assert.equal(game.next,BLACK);
  assert.equal(game.hideStones,true);
  assert.equal(hasGomokuForbidden(game),false);
  assert.equal(Object.hasOwn(game,"gomokuForbidden"),false);
  // 禁じ手 belongs to 五目並べ only.
  assert.equal(Object.hasOwn(newGame(true,{gomokuForbidden:true}),"gomokuForbidden"),false);
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
  const board=[...empty.board];
  for(const x of [3,4,5,6])board[at(x,6,13)]=BLACK;
  for(const x of [3,4,5])board[at(x,8,13)]=WHITE;
  board[at(2,6,13)]=WHITE;
  for(const strength of Object.keys(GOMOKU_LEVELS)){
    assert.equal(gomokuMove(empty.board,BLACK,Math.random,{strength}),at(6,6,13));
    // Black has four in a row with an open end: White must block, Black must win.
    assert.equal(gomokuMove(board,BLACK,Math.random,{strength}),at(7,6,13));
    // Even 入門 blocks a four when it notices it.
    assert.equal(gomokuMove(board,WHITE,()=>0,{strength}),at(7,6,13));
    // Its own five comes before blocking the opponent's.
    const threat=[...board];threat[at(6,8,13)]=WHITE;
    const win=gomokuMove(threat,WHITE,Math.random,{strength}),after=[...threat];after[win]=WHITE;
    assert.equal(makesFive(after,win),true);
  }
  // From ふつう up, a four or a three is never missed.
  const three=[...empty.board];
  for(const x of [4,5,6])three[at(x,6,13)]=BLACK;
  three[at(6,7,13)]=WHITE;three[at(7,8,13)]=WHITE;
  for(const strength of ["normal","strong","strongest"])
    assert.ok([at(3,6,13),at(7,6,13)].includes(gomokuMove(three,WHITE,()=>0.99,{strength})),strength);
});

test("つよい wins by fours in a row",()=>{
  // No single move wins yet, but a four at (8,6) forces (8,7), and (7,6)
  // then makes two fours at once.
  // つよい finds a sequence like it and plays it out against つよい.
  const board=newGame(true,{size:13,rules:"gomoku"}).board.slice();
  for(const [x,y] of [[8,3],[8,4],[8,5],[7,3],[7,4],[7,5],[5,6],[6,6]])board[at(x,y,13)]=BLACK;
  for(const [x,y] of [[8,2],[7,2],[4,6],[0,0],[12,12],[12,0],[0,12],[11,11]])board[at(x,y,13)]=WHITE;
  let color=BLACK,winner=null;
  for(let move=0;move<15 && !winner;move++,color=-color){
    const p=gomokuMove(board,color,()=>0,{strength:"strong"});
    board[p]=color;
    if(makesFive(board,p))winner=color;
  }
  assert.equal(winner,BLACK);
});

test("each 五目並べ level beats the one below it",()=>{
  // A seeded random, so the games are the same on every run.
  const seeded=seed=>()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  const play9=(black,white,seed)=>{
    const board=Array(81).fill(0),random=seeded(seed);
    for(let move=0,color=BLACK;move<81;move++,color=-color){
      const p=gomokuMove(board,color,random,{strength:color===BLACK?black:white});
      board[p]=color;
      if(makesFive(board,p))return color===BLACK?black:white;
    }
    return null;
  };
  const ladder=["beginner","easy","normal","strong"];
  for(let i=1;i<ladder.length;i++){
    let wins=0,losses=0;
    for(let seed=1;seed<=6;seed++){
      const [black,white]=seed%2?[ladder[i],ladder[i-1]]:[ladder[i-1],ladder[i]];
      const winner=play9(black,white,seed);
      if(winner===ladder[i])wins++;else if(winner)losses++;
    }
    assert.ok(wins>losses,ladder[i]+" "+wins+"-"+losses);
  }
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

// Black stones at (x,y) on an empty 13x13 board, for the 禁じ手 checks.
const blackAt=points=>{const b=Array(169).fill(0);for(const [x,y] of points)b[at(x,y,13)]=BLACK;return b;};
const p13=(x,y)=>at(x,y,13);

test("禁じ手: Black's 三三, 四四 and 長連 are forbidden, five always wins",()=>{
  // 三三: two open threes cross at (6,6).
  assert.equal(forbiddenReason(blackAt([[4,6],[5,6],[6,4],[6,5]]),p13(6,6)),"doubleThree");
  // One open three is fine; a three blocked by White is not a three.
  assert.equal(forbiddenReason(blackAt([[4,6],[5,6]]),p13(6,6)),null);
  const blocked=blackAt([[4,6],[5,6],[6,4],[6,5]]);blocked[p13(3,6)]=WHITE;
  assert.equal(forbiddenReason(blocked,p13(6,6)),null);
  // A split three (X_XX) counts.
  assert.equal(forbiddenReason(blackAt([[3,6],[5,6],[6,4],[6,5]]),p13(6,6)),"doubleThree");
  // 四四: two fours at once, also within one line (X_XXX_X).
  assert.equal(forbiddenReason(blackAt([[3,6],[4,6],[5,6],[6,3],[6,4],[6,5]]),p13(6,6)),"doubleFour");
  assert.equal(forbiddenReason(blackAt([[2,6],[4,6],[5,6],[8,6]]),p13(6,6)),"doubleFour");
  // A four and a three (四三) is allowed: it is how Black wins under renju.
  assert.equal(forbiddenReason(blackAt([[3,6],[4,6],[5,6],[6,4],[6,5]]),p13(6,6)),null);
  // 長連: six or more.
  assert.equal(forbiddenReason(blackAt([[1,6],[2,6],[3,6],[4,6],[5,6]]),p13(6,6)),"overline");
  // Five takes precedence over 三三 made at the same time.
  assert.equal(forbiddenReason(blackAt([[2,6],[3,6],[4,6],[5,6],[6,4],[6,5],[8,4],[7,5]]),p13(6,6)),null);
});

test("禁じ手 games forbid Black's shapes, keep White free, and survive replays and SGF",()=>{
  let game=newGame(true,{size:13,rules:"gomoku",gomokuForbidden:true});
  assert.equal(hasGomokuForbidden(game),true);
  assert.equal(hasGomokuForbidden(initialGame(game)),true);
  // Black (4,6),(5,6),(6,4),(6,5); White far away.
  game=line(game,[[4,6],[0,0],[5,6],[0,2],[6,4],[0,4],[6,5],[12,12]]);
  assert.throws(()=>play(game,p13(6,6)),{message:TEXT.rules.gomoku.doubleThree});
  const shown=inspectProvisionalMove(game,p13(6,6));
  assert.equal(shown.forbidden.reason,"doubleThree");
  assert.equal(forbiddenMessage("doubleThree"),TEXT.rules.gomoku.doubleThree);
  // The same point is fine without 禁じ手.
  const free=line(newGame(true,{size:13,rules:"gomoku"}),[[4,6],[0,0],[5,6],[0,2],[6,4],[0,4],[6,5],[12,12]]);
  assert.equal(play(free,p13(6,6)).board[p13(6,6)],BLACK);
  // White may make an overline and wins with it.
  let white=newGame(true,{size:13,rules:"gomoku",gomokuForbidden:true});
  white=line(white,[[0,12],[0,6],[2,12],[1,6],[4,12],[2,6],[6,12],[4,6],[8,12],[5,6],[10,12]]);
  white=play(white,p13(3,6));
  assert.equal(white.result,"W+");
  // The computer never picks a forbidden point for Black.
  assert.notEqual(gomokuMove(game.board,BLACK,()=>0,{forbidden:true}),p13(6,6));
  const sgf=exportSGF(game);
  assert.match(sgf,/^\(;GM\[4\]FF\[4\]CA\[UTF-8\]SZ\[13\]RU\[Renju\];B/);
  assert.equal(hasGomokuForbidden(parseSGF(sgf).snapshot),true);
  assert.equal(hasGomokuForbidden(parseSGF(exportSGF(free)).snapshot),false);
  // A friend's first board takes the inviter's 禁じ手 choice.
  assert.equal(reconcileGame(newGame(true,{size:13,rules:"gomoku"}),0,
    newGame(true,{size:13,rules:"gomoku",gomokuForbidden:true}),0).kind,"adopt");
  assert.equal(TEXT.game.ruleLabel(13,"gomoku",0,0,true),"13路 · 五目並べ · 禁じ手あり");
});

test("forbidden-point reasons are full sentences that wrap to two lines",async()=>{
  const {readFileSync}=await import("node:fs");
  const css=readFileSync(new URL("../public/style.css",import.meta.url),"utf8");
  assert.equal(forbiddenMessage("ko"),TEXT.rules.ko);
  assert.equal(forbiddenMessage("overline"),TEXT.rules.gomoku.overline);
  // What to do on the first line, why on the second.
  assert.equal(forbiddenLines("doubleThree"),"別の交点を選んでください。\n黒の三三で打てません。");
  assert.equal(forbiddenLines("ko"),"別の交点を選んでください。\nコウで打てません。");
  // Two lines in the turn row, never cut to one line with an ellipsis.
  assert.match(css,/\.end-status\{[^}]*white-space:pre-line[^}]*-webkit-line-clamp:2/);
  assert.doesNotMatch(css,/\.end-status\{[^}]*text-overflow:ellipsis/);
});
