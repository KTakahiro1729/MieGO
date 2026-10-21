import test from "node:test";
import assert from "node:assert/strict";
import {TEXT} from "../public/texts.mjs";
import {app,css,html,source} from "./helpers/source.mjs";

const renderer=source("board-renderer.mjs");
test("a direct board tap previews only the review candidate, not the live game",()=>{
 assert.match(app,/if\(boardReview\)\{[\s\S]*proposeReviewStone\(boardReview,game,position\)/);
 assert.match(app,/boardReview\.previewPosition=position/);
 assert.match(app,/if\(boardReview && !fromAi\)return/);
 assert.match(renderer,/boardReview\?\.preview\?\.board/);
 assert.match(app,/boardReview\.preview=null;boardReview\.previewPosition=null/);
});
test("preview buttons replace navigation without increasing the number of permanent rows",()=>{
 const start=html.indexOf('id="reviewTools"'),end=html.indexOf('id="saveStatus"',start);
 const controls=html.slice(start,end);
 assert.match(controls,/id="reviewPlayActions"/);
 assert.match(controls,/id="reviewCancel"/);
 assert.match(controls,/id="reviewConfirm"/);
 // The back button is the only way to the original line; no second button repeats it.
 assert.doesNotMatch(controls,/id="reviewOriginal"/);
 assert.match(controls,/id="reviewVariation"/);
 // Replay has no pass button: to pass, start a game with ここから打つ and pass there.
 assert.doesNotMatch(controls,/id="reviewPass"/);
 assert.match(controls,/id="reviewSaveVariation"/);
 assert.match(css,/\.review-navigation \.review-play-actions\[hidden\]\{display:none\}/);
 assert.match(css,/\.review-tools\[hidden\]\{display:none\}/);
 assert.match(css,/\.review-panel\[hidden\]\{display:none\}/);
});
test("review move handler never calls real apply, save, or P2P transport",()=>{
 const start=app.indexOf("function confirmReviewPreview()");
 const end=app.indexOf("function selectOriginalLine()",start);
 const body=app.slice(start,end);
 assert.match(body,/commitReviewStone\(boardReview,game,boardReview\.previewPosition\)/);
 assert.doesNotMatch(body,/apply\(|p2pTransport|submitMove\(|game=|save\(/);
 assert.match(app,/function selectOriginalLine\(\)/);
 assert.match(app,/function selectVariationLine\(\)/);
});
test("share and export use the chosen variation instead of silently exporting mainline",()=>{
 assert.match(app,/variationForSharing\(boardReview,game\)/);
 assert.match(app,/makeReviewUrl\(location\.origin,\{snapshot,sgfMeta:metadata\},step\)/);
 assert.match(app,/exportSGF\(\{snapshot:details\.snapshot,sgfMeta:details\.metadata\}\)/);
 assert.match(app,/gameLibrary\.save\(\{mode:"local",snapshot:boardReview\.variation\.snapshot,source:"variation"\}\)/);
});

test("replay keeps one action row; its other tools sit above the turn, with no menu",()=>{
 const review=html.slice(html.indexOf('<section id="reviewPanel"'),html.indexOf('<p id="saveStatus"'));
 const tools=html.slice(html.indexOf('id="reviewTools"'),html.indexOf('id="statusRow"'));
 for(const id of ["reviewBack",
   "reviewStepRange","reviewContinue"])
   assert.match(review+tools,new RegExp('id="'+id+'"'));
 assert.match(review,/class="review-navigation"/);
 assert.match(tools,/class="review-scrubber"/);
 // ◁▷ step one move; no second pair of arrows repeats them.
 assert.doesNotMatch(html,/id="reviewFirst"|id="reviewLast"/);
 assert.doesNotMatch(html,/id="reviewMenu"|review-menu-popover/);
 assert.match(app,/\$\("actionRow"\)\.hidden=true/);
 assert.match(app,/\$\("reviewPanel"\)\.hidden=true/);
 assert.match(app,/\$\("reviewPanel"\)\.hidden=false;\$\("reviewTools"\)\.hidden=false;/);
 assert.match(css,/\.review-panel\{[^}]*position:sticky/);
});
test("replay does not write moves to an active live or P2P session",()=>{
  assert.match(renderer,/const display=boardReview\?\.display\|\|game/);
  assert.match(app,/boardReview\.preview=proposeReviewStone\(boardReview,game,position\)/);
  assert.match(app,/if\(boardReview\)\{renderBoardReview\(\);return;\}/);
  assert.match(app,/if\(boardReview\.source==="live"\)boardReview\.snapshot=game/);
  assert.match(app,/const updates=source==="live"/);
});
test("saved records open directly on the main board from the saved-game entries",()=>{
  assert.match(html,/id="openHistoryFromNew"[^>]*><span>[\s\S]*?<strong>履歴<\/strong><\/span><\/label>/);
  assert.match(app,/if\(kind==="history"\)historyPanel\.showHistory\(\);/);
  assert.match(app,/enterBoardReview\(record\.snapshot,count,"archive",record\.sgfMeta,record\)/);
});
test("shared URLs open in review and do not replace active local saved positions",()=>{
  assert.match(app,/if\(!room && params\.has\("sgf"\)\)/);
  assert.match(app,/enterBoardReview\(imported\.snapshot,imported\.step,"url",imported\.metadata\)/);
  assert.match(app,/function clearImportedReviewUrl\(\)/);
  assert.match(app,/clearImportedReviewUrl\(\);\s*clearBoardReview\(\)/);
  assert.match(app,/if\(wasUrl\)clearImportedReviewUrl\(\)/);
});
test("AI copy is only a description of the link format, not separate SGF or a question prompt",()=>{
  const handoff=source("sgf-link.mjs");
  assert.match(handoff,/makeAiHandoff\(reviewUrl\)/);
  assert.match(handoff,/\.\.\.TEXT\.prompts\.handoffSpec/);
  assert.ok(TEXT.prompts.handoffSpec.some(line=>/SGFの着手列を合法な手順に編集/.test(line)));
  assert.doesNotMatch(html,/id="historyAiLink"/);
});

test("the status row keeps its height whatever it says",()=>{
 assert.match(css,/\.status-row \.step-button\{[^}]*height:44px/);
 assert.match(css,/\.turn\{[^}]*white-space:nowrap;overflow:hidden;text-overflow:ellipsis/);
});

test("sharing lives in one header sheet, not in the replay tools",()=>{
 const header=html.slice(html.indexOf('class="header-actions"'),html.indexOf('</header>'));
 assert.match(header,/id="shareToggle"[^>]*aria-label="共有を開く"[^>]*aria-controls="sharePanel"/);
 const sheet=html.slice(html.indexOf('<aside id="sharePanel"'),html.indexOf('<aside id="modePanel"'));
 for(const id of ["saveImage","shareImage","shareLink","shareAiLink","shareSgf","shareNotice","shareCopyFallback"])
   assert.match(sheet,new RegExp('id="'+id+'"'));
 const review=html.slice(html.indexOf('id="reviewTools"'),html.indexOf('id="reviewNotice"'));
 assert.doesNotMatch(review,/id="share|SGFを保存|URLをコピー|AI向け|GIF/);
 assert.doesNotMatch(review,/id="reviewContinue"/);
 const settings=html.slice(html.indexOf('<aside id="settingsPanel"'),html.indexOf('<aside id="sharePanel"'));
 assert.doesNotMatch(settings,/GIF/);
 // Only the AI copy needs words: what to do with the copied text.
 // Explanations live inside their buttons; the sheet has no loose notes.
 assert.doesNotMatch(sheet,/class="explanation"/);
 assert.match(sheet,/id="shareAiLink"[^>]*><span>チャットAI向けにコピー<\/span><small>今の盤面と棋譜URLの読み方をコピーします。好きなチャットAIに貼り付けると、この局面を相談できます<\/small><\/button>/);
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
 assert.match(css,/\.review-extras>button\{min-height:44px/);
 assert.doesNotMatch(html,/id="historyShareMenu"|id="historyExport"/);
});

test("saved games are a repeatable command, not a persistent fourth mode",()=>{
 assert.doesNotMatch(app,/modePicker/);
 assert.match(app,/\$\("openHistory"\)\.onclick=openHistoryPanel/);
 assert.match(app,/if\(boardReview\?\.source==="url"\)clearImportedReviewUrl\(\)/);
 assert.match(app,/gamePanel"\)\.classList\.remove\("is-scoring","is-finished"\)/);
});
test("◁ steps back one move at once; the replay row holds the way back",()=>{
  assert.match(app,/enterBoardReview\(game,game\.moves\.length-1,"live"\)/);
  assert.match(app,/\$\("stepForward"\)\.disabled=true/);
  assert.match(app,/\$\("reviewBack"\)\.onclick=leaveBoardReview/);
  assert.equal(TEXT.review.showing(28),"28手目を表示中");
  assert.equal(TEXT.review.tryHere,"試しに打つ");
  assert.match(html,/id="reviewConfirm"[^>]*><span id="reviewConfirmStone"[^>]*><\/span>試しに打つ/);
});
test("one primary slot in the replay row starts a game from the shown position",()=>{
  const row=html.slice(html.indexOf('class="review-navigation"'),html.indexOf('id="reviewMenu"'));
  assert.match(row,/id="reviewContinue" class="primary review-continue"[^>]*>ここから打つ</);
  // It opens the 新規対戦 sheet itself: same modes, same 自分の石 (観戦 included).
  assert.doesNotMatch(html,/id="continuePanel"|name="continueKind"/);
  assert.match(app,/openPanel\(fromLocal \|\| !canContinueWithAi\(\)\?"local":"ai"\)/);
  assert.match(app,/if\(continueFrom\)\{forkBoardReview\("ai"\);return;\}/);
  assert.match(app,/setWatching\(ai && watchChoice\);/);
  // The record fixes the board and rules; a friend game and 履歴 cannot start from a position.
  assert.match(app,/input\.value==="online" \|\| input\.value==="history"/);
  assert.match(app,/\["boardSize",sizeOf\(line\.board\)\],\["gameRules",rulesOf\(line\)\]/);
  assert.equal(TEXT.review.continueTitle(28),"28手目から打つ");
  assert.equal(TEXT.review.resume,"続きを打つ");
});
test("stepping to the live game's latest move stays in replay until the player leaves",()=>{
 const step=app.slice(app.indexOf("function setBoardReviewStep("),app.indexOf("function clearBoardReview("));
 assert.doesNotMatch(step,/leaveBoardReview/);
 assert.match(app,/review\.step===game\.moves\.length/);
});
