import test from "node:test";
import assert from "node:assert/strict";
import {TEXT} from "../public/texts.mjs";
import {source} from "./helpers/source.mjs";
const html=source("index.html"),app=source("app.mjs"),css=source("style.css"),retap=source("confirm-retap.mjs");

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
    assert.match(css,/\.action-row button\{white-space:nowrap;min-height:var\(--action-h\)\}/);
  assert.match(css,/\.review-navigation>button\{height:var\(--action-h\)/);
  assert.match(css,/\.review-play-actions button\{[^}]*height:var\(--action-h\)/);
  assert.match(css,/@media\(max-width:700px\)\{:root\{--action-h:54px;--action-pad-top:3px\}\}/);
  // Same outer height and gap above, so the board keeps its size when replay starts.
  assert.match(css,/\.action-row \.fused>button,\.action-row \.fused>label>span\{min-height:calc\(var\(--action-h\) - 2px\)\}/);
  assert.match(css,/\.action-row\{[^}]*margin:4px -2px 0/);
  assert.match(css,/\.review-panel\{[^}]*margin:4px -2px 0/);
  assert.doesNotMatch(css,/min-height:(3\d|4[0-3])px/);
});

test("the same action has the same name and glyph wherever it appears",()=>{
  // Discarding a provisional stone: × with the same label in play and in replay.
  assert.match(html,/id="reviewCancel"[^>]*aria-label="仮置きを戻す"[^>]*><svg[^>]*><path d="M6 6l12 12M18 6 6 18"\/><\/svg>/);
  assert.match(app,/const cancelLabel=provisional\?TEXT\.takeback\.undoProvisional/);
  assert.equal(TEXT.takeback.undoProvisional,"仮置きを戻す");
  // Both entries to the saved-game sheet carry the sheet's own title.
  assert.match(html,/id="openHistory"[^>]*>履歴<\/button>/);
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
  assert.equal((html.slice(html.indexOf('class="new-game-modes"'),html.indexOf('id="newGameSetup"')).match(/class="fused"/g)||[]).length,3);
  assert.doesNotMatch(html,/class="fused[^"]*"[^>]*>\s*<button[^>]*class="[^"]*primary/);
  // Hidden members leave no stray divider; an all-hidden group disappears.
  assert.match(css,/\.fused\{display:flex;gap:1px;/);
  assert.match(css,/\.fused:not\(:has\(>:not\(\[hidden\]\)\)\)\{display:none\}/);
});

test("every row under the board has a fixed height, so the board never changes size",()=>{
  // The board takes the height these rows leave; content must not change them.
  assert.match(css,/\.ownership-legend\{box-sizing:border-box;height:32px\}/);
  assert.match(css,/\.capture-counts\[hidden\]\{display:flex!important;visibility:hidden\}/);
  assert.match(css,/\.info-panel\{box-sizing:border-box;height:114px\}/);
  assert.match(css,/\.action-row,\.review-panel\{box-sizing:border-box;\s*height:calc\(var\(--action-h\) \+ var\(--action-pad-top\) \+ max\(6px,env\(safe-area-inset-bottom\)\)\)\}/);
  assert.match(css,/\.endgame-bar\{height:48px/);
});
