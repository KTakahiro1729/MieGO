import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TEXT} from "../public/texts.mjs";

const source=name=>readFileSync(new URL("../public/"+name,import.meta.url),"utf8");
const html=source("index.html"),app=source("app.mjs"),renderer=source("board-renderer.mjs"),style=source("style.css");
test("replay and variations share a single action row with a non-scrolling overlay menu",()=>{
 const review=html.slice(html.indexOf('<section id="reviewPanel"'),html.indexOf('<p id="saveStatus"'));
 for(const id of ["reviewPrevious","reviewNext","reviewFirst","reviewLast",
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
test("saved records open directly on the main board from the saved-game entries",()=>{
  assert.match(html,/id="openHistoryFromNew"[^>]*><span>[\s\S]*?<strong>履歴<\/strong><\/span><\/label>/);
  assert.match(app,/if\(kind==="history"\)historyPanel\.showHistory\(\);/);
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
  assert.match(handoff,/\.\.\.TEXT\.prompts\.handoffSpec/);
  assert.ok(TEXT.prompts.handoffSpec.some(line=>/SGFの着手列を合法な手順に編集/.test(line)));
  assert.doesNotMatch(handoff,/SGF本文：|次の一手を教えて|私は囲碁の初心者です/);
  assert.match(html,/id="shareAiLink"/);
  assert.doesNotMatch(html,/id="historyAiLink"/);
});

test("replay entry does not make the existing game header taller",()=>{
 assert.match(style,/\.move-history-toggle\{[^}]*min-height:26px/);
 assert.match(style,/\.move-history-toggle::before\{[^}]*inset:-9px 0/);
});

test("sharing lives in one header sheet, not in the replay menu",()=>{
 const header=html.slice(html.indexOf('class="header-actions"'),html.indexOf('</header>'));
 assert.match(header,/id="shareToggle"[^>]*aria-label="共有を開く"[^>]*aria-controls="sharePanel"/);
 const sheet=html.slice(html.indexOf('<aside id="sharePanel"'),html.indexOf('<aside id="modePanel"'));
 for(const id of ["saveImage","shareImage","shareLink","shareAiLink","shareSgf","shareNotice","shareCopyFallback"])
   assert.match(sheet,new RegExp('id="'+id+'"'));
 const review=html.slice(html.indexOf('id="reviewMenu"'),html.indexOf('id="reviewNotice"'));
 assert.doesNotMatch(review,/id="share|SGFを保存|URLをコピー|AI向け|GIF/);
 assert.match(review,/id="reviewResume"/);
 const settings=html.slice(html.indexOf('<aside id="settingsPanel"'),html.indexOf('<aside id="sharePanel"'));
 assert.doesNotMatch(settings,/GIF/);
 // Only the AI copy needs words: what to do with the copied text.
 // Explanations live inside their buttons; the sheet has no loose notes.
 assert.doesNotMatch(sheet,/class="explanation"/);
 assert.match(sheet,/id="shareAiLink"[^>]*><span>AI向けにコピー<\/span><small>この盤面をAIに相談したい時に使ってください。今の盤面とMieGOの使い方を説明した文章をクリップボードにコピーします<\/small><\/button>/);
 assert.match(sheet,/id="shareSgf"[^>]*><span>SGFを保存<\/span><small>[^<]+<\/small><\/button>/);
 // Still image or game animation side by side, then one share-or-save button.
 // Each choice shows the image it would share.
 assert.match(sheet,/class="ai-color-choices share-kind-choices"[\s\S]*value="still" checked><span><img id="shareStillPreview"[\s\S]*静止画<\/span>[\s\S]*value="animation"><span><img id="shareAnimationPreview"[\s\S]*棋譜アニメ（GIF）<\/span>[\s\S]*id="shareImage"/);
 assert.match(source("share-images.mjs"),/for\(const kind of SHARE_KINDS\)\{\s*try\{\s*const file=await makeShareImage\(kind,job\)/);
 // Outside replay the sheet shares the live game as it stands.
 assert.match(app,/if\(boardReview\)return \{\.\.\.variationForSharing\(boardReview,game\)/);
 assert.match(app,/return \{snapshot:game,metadata:null,/);
 // Inviting a friend stays in the match setup, not in sharing.
 assert.doesNotMatch(sheet,/shareInvite|招待/);
 assert.match(style,/\.review-menu-popover>button\{min-height:44px/);
 assert.doesNotMatch(html,/id="historyShareMenu"|id="historyExport"/);
});

test("saved games are a repeatable command, not a persistent fourth mode",()=>{
 assert.doesNotMatch(app,/modePicker/);
 assert.match(app,/\$\("openHistory"\)\.onclick=openHistoryPanel/);
 assert.match(app,/if\(boardReview\?\.source==="url"\)clearImportedReviewUrl\(\)/);
 assert.match(app,/gamePanel"\)\.classList\.remove\("is-scoring","is-finished"\)/);
});
test("the move chip steps back one move at once and turns into the way back",()=>{
  assert.match(app,/enterBoardReview\(game,game\.moves\.length-1,"live"\)/);
  assert.match(app,/\$\("moveLabel"\)\.classList\.add\("is-returning"\)/);
  assert.match(app,/\$\("moveLabel"\)\.classList\.remove\("is-returning"\)/);
  assert.equal(TEXT.review.showing(28),"28手目を表示中");
  assert.equal(TEXT.review.tryHere,"試しに打つ");
  assert.match(html,/id="reviewConfirm"[^>]*><span id="reviewConfirmStone"[^>]*><\/span>試しに打つ/);
});
