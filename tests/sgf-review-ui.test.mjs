import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=name=>readFileSync(new URL("../public/"+name,import.meta.url),"utf8");
const html=source("index.html"),app=source("app.mjs"),renderer=source("board-renderer.mjs"),style=source("style.css");
test("main board replay controls and sharing are directly visible",()=>{
  const review=html.slice(html.indexOf('<section id="reviewPanel"'),html.indexOf('<p id="saveStatus"'));
  for(const id of ["reviewPrevious","reviewNext","reviewBack","reviewFirst","reviewLast",
    "reviewStepRange","reviewLink","reviewAiLink","reviewBranch"])assert.match(review,new RegExp('id="'+id+'"'));
  assert.match(review,/class="review-direct-actions"/);
  assert.doesNotMatch(review,/<details|review-menu-popover/);
  assert.match(app,/\$\("actionRow"\)\.hidden=true/);
  assert.match(app,/\$\("reviewPanel"\)\.hidden=true/);
  assert.match(style,/\.review-tools\{display:flex/);
  assert.match(style,/\.review-panel\{[^}]*position:sticky/);
});
test("replay does not write moves to an active live or P2P session",()=>{
  assert.match(renderer,/const display=boardReview\?\.display\|\|game/);
  assert.match(app,/if\(boardReview\)return;\s*const rect=canvas\.getBoundingClientRect/);
  assert.match(app,/if\(boardReview && !fromAi\)return/);
  assert.match(app,/if\(boardReview\)\{renderBoardReview\(\);return;\}/);
  assert.match(app,/if\(boardReview\.source==="live"\)boardReview\.snapshot=game/);
  assert.match(app,/const updates=source==="live"/);
});
test("archives open on the main board without an additional screen or tab",()=>{
  assert.match(html,/id="historyBoard"[^>]*role="button"/);
  assert.match(app,/enterBoardReview\(record\.snapshot,step,"archive",record\.sgfMeta\)/);
  assert.match(app,/\$\("historyBoard"\)\.addEventListener\("keydown"/);
  assert.match(html,/id="historyLink"/);
  assert.match(html,/id="historyAiLink"/);
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
  assert.match(html,/id="historyAiLink"/);
});

test("replay entry does not make the existing game header taller",()=>{
 assert.match(style,/\.move-history-toggle\{[^}]*min-height:26px/);
 assert.match(style,/\.move-history-toggle::before\{[^}]*inset:-9px 0/);
});

test("saved history offers direct copy and export controls",()=>{
  const begin=html.indexOf('id="historyShareMenu"');
  const end=html.indexOf('id="historyActionNotice"',begin);
  const fragment=html.slice(begin,end);
  for(const id of ["historyExport","historyLink","historyAiLink"])
    assert.match(fragment,new RegExp('id="'+id+'"'));
  assert.match(html,/class="history-share-actions"/);
  assert.doesNotMatch(fragment,/<summary|history-share-popover/);
  assert.match(style,/\.history-share-actions\{display:flex/);
});
