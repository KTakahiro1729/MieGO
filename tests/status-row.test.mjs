import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");

test("every mode stacks header, board, bar with komi, ◁ status ▷, endgame, actions",()=>{
  const panel=html.slice(html.indexOf('<section id="gamePanel"'),html.indexOf('<p id="saveStatus"'));
  const order=['id="board"','id="ownershipLegend"','id="ruleLabel"','id="stepBack"','id="turn"','id="stepForward"',
    'id="endgameBar"','id="actionRow"','id="reviewPanel"'].map(id=>panel.indexOf(id));
  assert.ok(order.every(at=>at>=0));
  assert.deepEqual([...order].sort((a,b)=>a-b),order);
  assert.ok(html.indexOf("</header>")<html.indexOf('<section id="gamePanel"'));
  assert.doesNotMatch(panel,/class="game-meta"|move-history-toggle/);
});
test("the rules and komi sit in the bar's legend between its two ends",()=>{
  const labels=html.slice(html.indexOf('class="legend-labels"'),html.indexOf('id="statusRow"'));
  assert.ok(labels.indexOf('id="legendWhite"')<labels.indexOf('id="ruleLabel"'));
  assert.ok(labels.indexOf('id="ruleLabel"')<labels.indexOf('id="legendBlack"'));
});
test("◁ and ▷ step one move in the live game and in a replay",()=>{
  assert.match(app,/\$\("stepBack"\)\.onclick=\(\)=>\{\s*if\(boardReview\)\{setBoardReviewStep\(boardReview\.step-1\);return;\}/);
  assert.match(app,/\$\("stepForward"\)\.onclick=\(\)=>boardReview&&setBoardReviewStep\(boardReview\.step\+1\)/);
  assert.match(app,/\$\("stepForward"\)\.disabled=step>=count \|\| isPreview/);
});
test("the turn and the endgame (or the score) share one panel above the actions",()=>{
  const panel=html.slice(html.indexOf('id="infoPanel"'),html.indexOf('id="actionRow"'));
  for(const id of ["statusRow","endgameBar","scoreBox"])assert.match(panel,new RegExp('id="'+id+'"'));
  assert.match(html,/id="stepBack" class="icon-button step-button"/);
  assert.match(html,/id="stepForward" class="icon-button step-button"/);
});
