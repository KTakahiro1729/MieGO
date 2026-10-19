import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=name=>readFileSync(new URL("../public/"+name,import.meta.url),"utf8");
const html=source("index.html"),app=source("app.mjs"),style=source("style.css");
test("main board reuses one control row for move replay without scroll-inducing additions",()=>{
  const review=html.slice(html.indexOf('<section id="reviewPanel"'),html.indexOf('<p id="saveStatus"'));
  assert.match(review,/class="review-navigation"/);
  assert.match(review,/id="reviewPrevious"/);
  assert.match(review,/id="reviewNext"/);
  assert.match(review,/id="reviewBack"/);
  assert.match(review,/id="reviewMenu"/);
  assert.ok(review.indexOf('id="reviewStepRange"')>review.indexOf('class="review-menu-popover"'));
  assert.ok(review.indexOf('id="reviewLink"')>review.indexOf('class="review-menu-popover"'));
  assert.ok(review.indexOf('id="reviewAiLink"')>review.indexOf('class="review-menu-popover"'));
  assert.match(app,/\$\("actionRow"\)\.hidden=true/);
  assert.match(app,/\$\("reviewPanel"\)\.hidden=true/);
  assert.match(style,/\.review-menu-popover\{position:absolute/);
  assert.match(style,/\.review-panel\{[^}]*position:sticky/);
  assert.doesNotMatch(review,/class="review-explanation"|class="review-share"/);
});
test("replay does not write moves to an active live or P2P session",()=>{
  assert.match(app,/const display=boardReview\?\.display\|\|game/);
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

test("saved history share replaces SGF export button height instead of adding another row",()=>{
 const begin=html.indexOf('id="historyShareMenu"');
 const end=html.indexOf('id="historyActionNotice"',begin);
 const fragment=html.slice(begin,end);
 assert.match(fragment,/id="historyExport"/);
 assert.match(fragment,/id="historyLink"/);
 assert.match(fragment,/id="historyAiLink"/);
 assert.match(style,/\.history-share-popover\{position:absolute/);
 assert.match(style,/\.history-share-menu>summary\{min-height:44px/);
 assert.doesNotMatch(html,/class="history-share-actions"/);
});
