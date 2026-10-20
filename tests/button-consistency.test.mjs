import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {TEXT} from "../public/texts.mjs";
const get=name=>readFileSync(new URL("../public/"+name,import.meta.url),"utf8");
const html=get("index.html"),app=get("app.mjs"),css=get("style.css"),retap=get("confirm-retap.mjs");

test("buttons draw colours from the four shared kinds, not per-button overrides",()=>{
  for(const kind of [".secondary{",".accent-outline{",".danger-armed{"])assert.ok(css.includes(kind),kind);
  assert.doesNotMatch(css,/(^|[^\w-])\.outline\{/m);
  assert.doesNotMatch(css,/#(shareAiLink|endAccept|reviewConfirm)[^{]*\{[^}]*background/);
  assert.doesNotMatch(css,/\.review-confirm\{[^}]*background/);
  assert.doesNotMatch(css,/\.resign-control[^{]*\{[^}]*(background|color)/);
  assert.doesNotMatch(html,/class="([^"]*\s)?outline[\s"]/);
});

test("an armed button is marked by a class, not by its aria-label text",()=>{
  assert.match(retap,/button\.classList\.add\("danger-armed"\)/);
  assert.match(retap,/armedConfirm\.button\.classList\.remove\("danger-armed"\)/);
  assert.doesNotMatch(css,/aria-label\^=/);
});

test("the action, scoring and replay rows share one height token",()=>{
  assert.match(css,/--action-h:55px/);
  assert.match(css,/@media\(max-width:700px\)\{:root\{--action-h:54px\}\}/);
  assert.match(css,/\.action-row button\{white-space:nowrap;min-height:var\(--action-h\)\}/);
  assert.match(css,/\.review-navigation>button\{height:var\(--action-h\)/);
  assert.match(css,/\.review-play-actions button\{[^}]*height:var\(--action-h\)/);
  assert.match(css,/@media\(max-width:700px\)\{\.action-row,\.review-panel\{padding-top:3px\}\}/);
  assert.doesNotMatch(css,/min-height:(3\d|4[0-3])px/);
});

test("the same action has the same name and glyph wherever it appears",()=>{
  // Discarding a provisional stone: × with the same label in play and in replay.
  assert.match(html,/id="reviewCancel"[^>]*aria-label="仮置きを戻す"[^>]*><svg[^>]*><path d="M6 6l12 12M18 6 6 18"\/><\/svg>/);
  assert.match(app,/const cancelLabel=provisional\?TEXT\.takeback\.undoProvisional/);
  assert.equal(TEXT.takeback.undoProvisional,"仮置きを戻す");
  // Both entries to the saved-game sheet carry the sheet's own title.
  assert.match(html,/id="openHistory"[^>]*>保存した棋譜<\/button>/);
  assert.match(html,/id="shareSgf" class="secondary full described" type="button"><span>SGFを保存<\/span>/);
  // Sheet close buttons draw the same SVG × rather than a text glyph.
  assert.doesNotMatch(html,/>×<\/button>/);
  assert.doesNotMatch(html,/>[‹›≪≫]<\/button>|>•••<\/summary>/);
});

test("each control row keeps continue-left, advance-right with at most one gold button",()=>{
  const row=html.slice(html.indexOf('id="reviewPlayActions"'),html.indexOf('id="reviewContinue"'));
  assert.ok(row.indexOf('id="reviewCancel"')<row.indexOf('id="reviewConfirm"'));
  assert.match(row,/id="reviewConfirm" class="review-confirm primary"/);
  const menu=html.slice(html.indexOf('id="reviewTools"'),html.indexOf('id="reviewNotice"'));
  assert.doesNotMatch(menu,/primary/);
});
test("related buttons fuse into one group; the primary stays apart (UX policy §3.6)",()=>{
  const group=cls=>{const at=html.indexOf('class="fused '+cls+'"');assert.ok(at>=0,cls);return html.slice(at,html.indexOf("</div>",at));};
  const moves=group("move-controls");
  for(const id of ["cancel","resign","pass"])assert.match(moves,new RegExp('id="'+id+'"'));
  assert.doesNotMatch(moves,/id="confirm"|class="primary/);
  for(const cls of ["new-game-modes","ai-color-choices board-size-choices","ai-color-choices rules-choices"])group(cls);
  assert.doesNotMatch(html,/class="fused[^"]*"[^>]*>\s*<button[^>]*class="[^"]*primary/);
  // Hidden members leave no stray divider; an all-hidden group disappears.
  assert.match(css,/\.fused\{display:flex;gap:1px;/);
  assert.match(css,/\.fused:not\(:has\(>:not\(\[hidden\]\)\)\)\{display:none\}/);
});
