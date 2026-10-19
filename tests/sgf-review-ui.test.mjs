import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=name=>readFileSync(new URL("../public/"+name,import.meta.url),"utf8");
const html=source("index.html"),app=source("app.mjs"),renderer=source("board-renderer.mjs"),style=source("style.css");
test("replay and variations share a single action row with a non-scrolling overlay menu",()=>{
 const review=html.slice(html.indexOf('<section id="reviewPanel"'),html.indexOf('<p id="saveStatus"'));
 for(const id of ["reviewPrevious","reviewNext","reviewBack","reviewFirst","reviewLast",
   "reviewStepRange","reviewLink","reviewAiLink","reviewResume","reviewExport","reviewBranch"])
   assert.match(review,new RegExp('id="'+id+'"'));
 assert.match(review,/class="review-navigation"/);
 assert.match(review,/id="reviewPlayActions"/);
 assert.match(review,/class="review-menu-popover"/);
 assert.match(review,/<details id="reviewMenu"/);
 assert.match(app,/\$\("actionRow"\)\.hidden=true/);
 assert.match(app,/\$\("reviewPanel"\)\.hidden=true/);
 assert.match(style,/\.review-navigation>\.review-menu \.review-menu-popover\{position:absolute/);
 assert.match(style,/\.review-panel\{[^}]*position:sticky/);
});
test("replay does not write moves to an active live or P2P session",()=>{
  assert.match(renderer,/const display=boardReview\?\.display\|\|game/);
  assert.match(app,/boardReview\.preview=proposeReviewStone\(boardReview,game,position\)/);
  assert.match(app,/if\(boardReview && !fromAi\)return/);
  assert.match(app,/if\(boardReview\)\{renderBoardReview\(\);return;\}/);
  assert.match(app,/if\(boardReview\.source==="live"\)boardReview\.snapshot=game/);
  assert.match(app,/const updates=source==="live"/);
});
test("saved records open directly on the main board from the saved-game entries",()=>{
  assert.match(html,/id="openHistoryFromNew"[^>]*>[\s\S]*?<strong>履歴<\/strong><\/button>/);
  assert.match(app,/\$\("openHistoryFromNew"\)\.onclick=openHistoryPanel/);
  assert.match(app,/enterBoardReview\(record\.snapshot,count,"archive",record\.sgfMeta,record\)/);
  assert.doesNotMatch(html,/id="historyBoard"|id="historyStepRange"/);
  assert.match(html,/id="openHistory"/);
  assert.match(html,/id="reviewLink"/);
  assert.match(html,/id="reviewAiLink"/);
  assert.match(html,/id="reviewExport"/);
});
test("shared URLs open in review and do not replace active local saved positions",()=>{
  assert.match(app,/if\(!room && params\.has\("sgf"\)\)/);
  assert.match(app,/enterBoardReview\(imported\.snapshot,imported\.step,"url",imported\.metadata\)/);
  assert.match(app,/function clearImportedReviewUrl\(\)/);
  assert.match(app,/clearImportedReviewUrl\(\);\s*boardReview=null/);
  assert.match(app,/if\(wasUrl\)clearImportedReviewUrl\(\)/);
});
test("AI copy is only a description of the link format, not separate SGF or a question prompt",()=>{
  const handoff=source("sgf-link.mjs");
  assert.match(handoff,/makeAiHandoff\(reviewUrl\)/);
  assert.match(handoff,/SGFの着手列を合法な手順に編集/);
  assert.doesNotMatch(handoff,/SGF本文：|次の一手を教えて|私は囲碁の初心者です/);
  assert.match(html,/id="reviewAiLink"/);
  assert.doesNotMatch(html,/id="historyAiLink"/);
});

test("replay entry does not make the existing game header taller",()=>{
 assert.match(style,/\.move-history-toggle\{[^}]*min-height:26px/);
 assert.match(style,/\.move-history-toggle::before\{[^}]*inset:-9px 0/);
});

test("SGF exports and AI sharing share the existing single-row replay menu",()=>{
 const review=html.slice(html.indexOf('id="reviewMenu"'),html.indexOf('id="reviewCopyFallback"'));
 assert.match(review,/id="reviewExport"/);
 assert.match(review,/id="reviewLink"/);
 assert.match(review,/id="reviewAiLink"/);
 assert.match(review,/id="reviewResume"/);
 assert.match(style,/\.review-menu-popover>button\{min-height:44px/);
 assert.doesNotMatch(html,/id="historyShareMenu"|id="historyExport"/);
});

test("saved games are a repeatable command, not a persistent fourth mode",()=>{
 assert.doesNotMatch(app,/modePicker/);
 assert.match(app,/\$\("openHistory"\)\.onclick=openHistoryPanel/);
 assert.match(app,/if\(boardReview\?\.source==="url"\)clearImportedReviewUrl\(\)/);
 assert.match(app,/gamePanel"\)\.classList\.remove\("is-scoring","is-finished"\)/);
});
