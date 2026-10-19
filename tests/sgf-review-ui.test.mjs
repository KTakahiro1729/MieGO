import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=name=>readFileSync(new URL("../public/"+name,import.meta.url),"utf8");
const html=source("index.html"),app=source("app.mjs"),renderer=source("board-renderer.mjs"),style=source("style.css");
test("replay and variations share a single action row with a non-scrolling overlay menu",()=>{
 const review=html.slice(html.indexOf('<section id="reviewPanel"'),html.indexOf('<p id="saveStatus"'));
 for(const id of ["reviewPrevious","reviewNext","reviewBack","reviewFirst","reviewLast",
   "reviewStepRange","reviewResume","reviewBranch"])
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
test("saved records open directly on the main board from the header picker",()=>{
  assert.match(html,/<option value="history">保存した棋譜…<\/option>/);
  assert.match(app,/if\(selected==="history"\)openHistoryPanel\(\)/);
  assert.match(app,/enterBoardReview\(record\.snapshot,count,"archive",record\.sgfMeta,record\)/);
  assert.doesNotMatch(html,/id="historyBoard"|id="historyStepRange"/);
  assert.match(html,/id="openHistory"/);
  assert.match(html,/id="shareLink"/);
  assert.match(html,/id="shareAiLink"/);
  assert.match(html,/id="shareSgf"/);
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
  assert.match(html,/id="shareAiLink"/);
  assert.doesNotMatch(html,/id="historyAiLink"/);
});

test("replay entry does not make the existing game header taller",()=>{
 assert.match(style,/\.move-history-toggle\{[^}]*min-height:26px/);
 assert.match(style,/\.move-history-toggle::before\{[^}]*inset:-9px 0/);
});

test("sharing lives in one sheet beside settings, not in the replay menu",()=>{
 const header=html.slice(html.indexOf('class="header-actions"'),html.indexOf('</header>'));
 assert.ok(header.indexOf('id="settingsToggle"')<header.indexOf('id="shareToggle"'),"share sits right of settings");
 assert.match(header,/id="shareToggle"[^>]*aria-label="共有を開く"[^>]*aria-controls="sharePanel"/);
 const sheet=html.slice(html.indexOf('<aside id="sharePanel"'),html.indexOf('<aside id="modePanel"'));
 for(const id of ["shareGif","shareImage","shareLink","shareAiLink","shareSgf","shareInvite","shareNotice","shareCopyFallback"])
   assert.match(sheet,new RegExp('id="'+id+'"'));
 const review=html.slice(html.indexOf('id="reviewMenu"'),html.indexOf('id="reviewNotice"'));
 assert.doesNotMatch(review,/id="share|SGFを保存|URLをコピー|AI向け|GIF/);
 assert.match(review,/id="reviewResume"/);
 const settings=html.slice(html.indexOf('<aside id="settingsPanel"'),html.indexOf('<aside id="sharePanel"'));
 assert.doesNotMatch(settings,/GIF/);
 // Only the AI copy needs words: what to do with the copied text.
 assert.equal(sheet.match(/class="explanation"/g)?.length,2,"target line and the AI note");
 assert.match(sheet,/id="shareAiLink"[^>]*>AI向けにコピー<\/button>\s*<p class="explanation">好きなAIのチャットに貼り付けると/);
 // Outside replay the sheet shares the live game as it stands.
 assert.match(app,/if\(boardReview\)return variationForSharing\(boardReview,game\);/);
 assert.match(app,/\$\("shareInviteSection"\)\.hidden=!room/);
 assert.match(style,/\.review-menu-popover>button\{min-height:44px/);
 assert.doesNotMatch(html,/id="historyShareMenu"|id="historyExport"/);
});

test("saved-game picker is a repeatable command, not a persistent fourth mode",()=>{
 assert.match(app,/modePicker"\)\.value=room\?"online":gameMode/);
 assert.match(app,/if\(selected==="history"\)openHistoryPanel\(\)/);
 assert.match(app,/if\(boardReview\?\.source==="url"\)clearImportedReviewUrl\(\)/);
 assert.match(app,/gamePanel"\)\.classList\.remove\("is-scoring","is-finished"\)/);
});
