import test from "node:test";
import assert from "node:assert/strict";
import { newGame, play, at, boardHash } from "../public/core.mjs";
import { personalityFeatures, scorePolicyCandidates, STYLE_AXES } from "../public/ai-opponent.mjs";
import {
  AI_CHARACTERS,
  CUSTOM_CHARACTER,
  characterLabel,
  characterNote,
  characterOf,
  comFor,
  comSummary,
  normalizeCom,
  pickCharacter,
  readCom,
  setComValue,
} from "../public/ai-characters.mjs";
import { TEXT } from "../public/texts.mjs";
import { AI_STRENGTHS } from "../public/ai-strength.mjs";

const position=stones=>{
  const s=newGame();
  for(const [p,c] of stones)s.board[p]=c;
  s.history=[boardHash(s.board)];
  return s;
};
const scoreOf=(s,point,options)=>{
  const policy=Array(81).fill(-50);policy[point]=0;
  return scorePolicyCandidates(s,policy,null,options).find(c=>c.position===point).score;
};

test("the attack signal rewards ataris, captures and cuts, never a stone left in atari",()=>{
  // White stone at 4,4 with black on two sides: a third black stone puts it in atari.
  const s=position([[at(4,4),-1],[at(3,4),1],[at(4,3),1]]);
  assert.equal(personalityFeatures(s,at(5,4),null).attack,1);
  assert.equal(personalityFeatures(s,at(7,7),null).attack,0);
  // Black between two separate white stones cuts them.
  const cut=position([[at(3,3),-1],[at(4,4),-1],[at(0,0),1]]);
  assert.ok(personalityFeatures(cut,at(3,4),null).attack>=0.6);
  // Black at 1,0 would sit in atari between two white stones: not an attack.
  const thrown=position([[at(2,0),-1],[at(1,1),-1]]);
  assert.equal(personalityFeatures(thrown,at(1,0),null).attack,0);
  const attacking={stance:100};
  assert.ok(scoreOf(s,at(5,4),attacking)>scoreOf(s,at(5,4),{}));
  assert.equal(scoreOf(s,at(7,7),attacking),scoreOf(s,at(7,7),{}));
  assert.ok(scoreOf(s,at(5,4),{stance:0})<scoreOf(s,at(5,4),{}));
});

test("攻守 trades attacking for reinforcing, and an old 補強度 reads as 守る",()=>{
  // Black 1,1 has two liberties left; 1,2 adds liberties.
  const s=position([[at(1,1),1],[at(0,1),-1],[at(1,0),-1],[at(2,1),-1]]);
  const owners=Array(81).fill(0);owners[at(1,2)]=.45;
  const policy=Array(81).fill(-50);policy[at(1,2)]=0;
  const score=options=>scorePolicyCandidates(s,policy,owners,options).find(c=>c.position===at(1,2)).score;
  assert.ok(score({stance:0})>score({})&&score({})>score({stance:100}));
  assert.equal(score({reinforcement:100}),score({stance:0}));
  assert.equal(score({reinforcement:0}),score({stance:100}));
  assert.equal(normalizeCom({strength:"easy",reinforcement:100}).stance,0);
});

test("height sorts the 2nd-3rd lines from the 4th line and up, and fades as the board fills",()=>{
  const s=newGame();
  assert.equal(personalityFeatures(s,at(2,2),null).height,-1);
  assert.equal(personalityFeatures(s,at(1,4),null).height,-1);
  assert.equal(personalityFeatures(s,at(3,3),null).height,1);
  assert.equal(personalityFeatures(s,at(0,4),null).height,0);
  assert.ok(scoreOf(s,at(2,2),{height:0})>scoreOf(s,at(3,3),{height:0}));
  assert.ok(scoreOf(s,at(3,3),{height:100})>scoreOf(s,at(2,2),{height:100}));
  const full=newGame();
  for(let p=0;p<50;p++)full.board[p]=p%2?1:-1;
  full.history=[boardHash(full.board)];
  assert.equal(personalityFeatures(full,at(3,7),null).height,0);
});

test("tenuki measures the distance from the opponent's last move",()=>{
  const s=play(newGame(),at(2,2));
  assert.equal(personalityFeatures(s,at(3,2),null).tenuki,-1);
  assert.equal(personalityFeatures(s,at(5,2),null).tenuki,0);
  assert.equal(personalityFeatures(s,at(7,7),null).tenuki,1);
  // No last move to answer at the start or after a pass.
  assert.equal(personalityFeatures(newGame(),at(4,4),null).tenuki,0);
  assert.equal(personalityFeatures(play(s,null),at(4,4),null).tenuki,0);
  assert.ok(scoreOf(s,at(3,2),{tenuki:0})>scoreOf(s,at(7,7),{tenuki:0}));
  assert.ok(scoreOf(s,at(7,7),{tenuki:100})>scoreOf(s,at(3,2),{tenuki:100}));
});

test("a style pulls as hard on one axis as on two, and つよい reorders only moves close to the best",()=>{
  const s=play(newGame(),at(2,2));
  const policy=Array(81).fill(-50);policy[at(7,7)]=0;policy[at(3,2)]=-0.5;policy[at(6,6)]=-2;
  const bonus=(options,point)=>{const c=scorePolicyCandidates(s,policy,null,options).find(c=>c.position===point);return c.score-c.raw;};
  // 7,7 lies five lines from the last move, on the 2nd line: far (tenuki +1) and low (height -1).
  const one=bonus({tenuki:100,allMoves:true},at(7,7)),two=bonus({tenuki:100,height:0,allMoves:true},at(7,7));
  assert.equal(one,3);
  assert.equal(two,3);
  // つよい: a quarter of the pull, and none for a move further than STYLE_SLACK below the best.
  assert.equal(bonus({tenuki:0},at(3,2)),0.75);
  assert.equal(bonus({tenuki:100},at(6,6)),0);
});

test("neutral axes leave KataGo's policy untouched",()=>{
  const s=play(newGame(),at(2,2));
  const policy=Array.from({length:81},(_,p)=>-p/10);
  for(const c of scorePolicyCandidates(s,policy,null,{}))assert.ok(c.score===c.raw);
});

test("each character is a value on every axis and a one-line note, with no strength of its own",()=>{
  for(const [key,c] of Object.entries(AI_CHARACTERS)){
    assert.equal(c.strength,undefined,key);
    for(const axis of STYLE_AXES)assert.ok([0,50,100].includes(c[axis]),key+" "+axis);
    assert.ok(characterLabel(key).length>0);
    assert.ok(characterNote(key).length<=26,key);
    for(const strength of Object.keys(AI_STRENGTHS)){
      const com=comFor(key,{strength});
      assert.equal(com.strength,strength);
      assert.equal(characterOf(com),key);
    }
  }
});

test("a new strength keeps the character, and a saved ひよこ, 本気 or 名人 reads as 素直 at its strength",()=>{
  const raider=pickCharacter(readCom({character:"plain"},"beginner"),"raider");
  assert.equal(raider.strength,"beginner");
  const stronger=setComValue(raider,"strength","normal");
  assert.deepEqual(stronger,{...AI_CHARACTERS.raider,character:"raider",strength:"normal"});
  // Saves from when each character came with its own strength.
  const neutral={height:50,resign:0,stance:50,tenuki:50};
  for(const [character,strength] of [["chick","beginner"],["serious","strong"],["master","strongest"]])
    assert.deepEqual(readCom({character,strength,...neutral}),{character:"plain",strength,...neutral});
  assert.deepEqual(readCom({character:"steady",strength:"easy",...neutral,stance:0}),
    {character:"steady",strength:"easy",...neutral,stance:0});
});

test("最強 says it leaves the style aside, but keeps 終局の提案",()=>{
  assert.doesNotMatch(comSummary(comFor("plain",{strength:"strongest"})),/好み/);
  const wide=comSummary(comFor("wide",{strength:"strongest"}));
  assert.ok(wide.endsWith(TEXT.ai.strongestNoStyle));
  assert.doesNotMatch(wide,/序盤/);
  assert.match(comSummary({strength:"strongest",resign:100,stance:100}),/終局の提案/);
  assert.match(comSummary(comFor("wide",{strength:"easy"})),/序盤「勢力を作る」/);
});

test("settings that match no character open as カスタム, with every axis snapped to a stop",()=>{
  assert.equal(characterOf({strength:"strong",invasion:50,reinforcement:50}),"plain");
  assert.equal(characterOf({strength:"easy",stance:100}),CUSTOM_CHARACTER);
  assert.equal(characterOf({strength:"easy",invasion:10,reinforcement:90}),"steady");
  assert.equal(characterOf({strength:"easy",invasion:90,height:20}),"raider");
  assert.deepEqual(normalizeCom({strength:"nope",invasion:70}),
    {strength:"strong",height:50,resign:0,stance:50,tenuki:50});
  assert.deepEqual(comFor(CUSTOM_CHARACTER,{strength:"easy",stance:100}),
    {strength:"easy",height:50,resign:0,stance:100,tenuki:50});
  // A COM saved while 侵入度 was its own axis: 攻守 takes the mean of the two.
  assert.equal(normalizeCom({stance:50,invasion:100}).stance,100);
  assert.equal(normalizeCom({stance:0,invasion:100}).stance,50);
  assert.equal(characterOf({strength:"easy",height:0,invasion:100,stance:50,tenuki:50}),"raider");
  assert.equal(characterLabel(CUSTOM_CHARACTER),"カスタム");
});

test("終局の提案 starts at 最後まで for every character, and choosing it makes the COM カスタム",()=>{
  for(const c of Object.values(AI_CHARACTERS))assert.equal(c.resign,0);
  // Saves from before the setting play every game out.
  assert.equal(normalizeCom({strength:"easy"}).resign,0);
  const com=setComValue({character:"plain",strength:"beginner",...AI_CHARACTERS.plain},"resign","50");
  assert.equal(com.character,CUSTOM_CHARACTER);
  assert.equal(com.resign,50);
  assert.match(comSummary(com),/終局の提案「大差で提案」/);
  assert.doesNotMatch(comSummary(comFor("plain",{strength:"beginner"})),/終局の提案/);
});
