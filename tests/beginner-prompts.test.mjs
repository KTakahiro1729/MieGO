import test from "node:test";
import assert from "node:assert/strict";
import {newGame,play} from "../public/core.mjs";
import {makeRulesPrompt,makePositionPrompt} from "../public/beginner-prompts.mjs";
import {source} from "./helpers/source.mjs";
const html=source("index.html");

test("the rules question says the asker is a beginner and names this game's rules",()=>{
  const text=makeRulesPrompt(newGame(true,{size:13}));
  assert.match(text,/初心者/);
  assert.match(text,/13路盤/);
  assert.match(text,/中国ルール/);
  assert.match(text,/コミ7\.5目/);
  for(const topic of ["呼吸点","コウ","地","終局"])assert.match(text,new RegExp(topic));
  assert.doesNotMatch(text,/現在の盤面/);
});

test("the rules question follows the game on the board",()=>{
  const japanese=makeRulesPrompt(newGame(true,{size:19,rules:"japanese"}));
  assert.match(japanese,/日本ルール/);
  assert.match(japanese,/コミ6\.5目/);
  const gomoku=makeRulesPrompt(newGame(true,{size:13,rules:"gomoku",gomokuForbidden:true}));
  assert.match(gomoku,/五目並べを始めたばかり/);
  assert.match(gomoku,/禁じ手あり/);
  assert.match(gomoku,/三三・四四・長連/);
  for(const word of ["中国ルール","コミ","呼吸点","コウ","囲碁の基本"])assert.doesNotMatch(gomoku,new RegExp(word));
  assert.match(makeRulesPrompt(newGame(true,{rules:"gomoku"})),/禁じ手なし/);
  const free=makeRulesPrompt(newGame(true,{rules:"free"}));
  assert.match(free,/自由に石を置いて/);
  assert.doesNotMatch(free,/中国ルール|コミ|五目並べ/);
});

test("the position question follows the game on the board",()=>{
  let gomoku=newGame(true,{size:9,rules:"gomoku"});
  for(const n of [0,9,1,10,2,11,3,12,4])gomoku=play(gomoku,n);
  const ended=makePositionPrompt(gomoku);
  assert.match(ended,/五目並べ/);
  assert.match(ended,/どこで勝負が決まったか/);
  assert.doesNotMatch(ended,/中国ルール|地にしている/);
  const free=makePositionPrompt(play(newGame(true,{rules:"free"}),40));
  assert.match(free,/盤上に1子置いています/);
  assert.doesNotMatch(free,/手番|中国ルール/);
});

test("the position question carries the board, the turn and handicap rules",()=>{
  let game=newGame(true,{size:9});
  assert.match(makePositionPrompt(game),/まだ1手も打っていません/);
  game=play(game,40);
  const text=makePositionPrompt(game,"https://miego.example/?sgf=x&move=1");
  assert.match(text,/手番：白。1手目まで打ちました。/);
  assert.match(text,/上から○行目・左から○列目/);
  assert.match(text,/棋譜URL: https:\/\/miego\.example\/\?sgf=x&move=1/);
  // Point 40 is the centre of 9x9: fifth row, fifth column.
  assert.match(text,/現在の盤面：\n(.+\n){4}(・ ){4}● (・ ){3}・\n/);
  assert.match(makePositionPrompt(newGame(true,{size:9,handicap:3})),/置き石3子、コミなし · 置き石補正3目/);
});

test("the position question never carries a private room URL",()=>{
  assert.throws(()=>makePositionPrompt(newGame(),"https://miego.example/?room=abc"));
  assert.throws(()=>makePositionPrompt(newGame(),"javascript:alert(1)"));
});

test("the help sheet opens with the beginner questions and falls back to manual copy",()=>{
  const sheet=html.slice(html.indexOf('<aside id="helpPanel"'));
  assert.ok(sheet.indexOf('id="help-beginner"')<sheet.indexOf('id="help-endgame"'));
  assert.match(sheet,/id="copyRulesPrompt"[^>]*>ルールの質問をコピー<\/button>/);
  assert.match(sheet,/id="copyPositionPrompt"[^>]*>今の局面の質問をコピー<\/button>/);
});
