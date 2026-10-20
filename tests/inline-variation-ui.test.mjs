import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const get=name=>readFileSync(new URL("../public/"+name,import.meta.url),"utf8");
const html=get("index.html"),app=get("app.mjs"),css=get("style.css"),renderer=get("board-renderer.mjs");
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
 assert.match(controls,/id="reviewOriginal"/);
 assert.match(controls,/id="reviewVariation"/);
 assert.match(controls,/id="reviewPass"/);
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
