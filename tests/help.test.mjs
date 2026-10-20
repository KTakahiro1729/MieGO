import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const get=name=>readFileSync(new URL("../public/"+name,import.meta.url),"utf8");
const html=get("index.html"),app=get("app.mjs"),css=get("style.css"),help=get("help-sheet.mjs");
const sheet=html.slice(html.indexOf('<aside id="helpPanel"'),html.indexOf('</aside>',html.indexOf('<aside id="helpPanel"')));
const topics=new Set([...sheet.matchAll(/<details id="help-([\w-]+)"/g)].map(m=>m[1]));

test("the header offers help between 新規対戦 and the settings gear",()=>{
  const header=html.slice(html.indexOf('class="header-actions"'),html.indexOf('</header>'));
  assert.ok(header.indexOf('id="newGameButton"')<header.indexOf('id="helpToggle"'));
  assert.ok(header.indexOf('id="helpToggle"')<header.indexOf('id="settingsToggle"'));
  assert.match(header,/id="helpToggle" class="icon-button"[^>]*aria-label="ヘルプを開く"[^>]*aria-controls="helpPanel"/);
  assert.match(help,/\$\("helpToggle"\)\.onclick=/);
});

test("explanations live in the help sheet instead of being scattered",()=>{
  assert.match(sheet,/role="dialog" aria-modal="true" aria-labelledby="helpTitle"/);
  for(const topic of ["beginner","basics","moves","endgame","scoring","illegal","ownership","rules","local","ai","online","history","about"])
    assert.ok(topics.has(topic),topic);
  // The long notes that used to sit in settings and the AI options are gone from there.
  const outside=html.replace(sheet,"");
  assert.doesNotMatch(outside,/地合いの表示について|段級位の目安ではありません|クレジット/);
});

test("every local help button names an existing topic",()=>{
  const buttons=[...html.matchAll(/<button class="help-button"[^>]*data-help="([\w-]+)"[^>]*>/g)];
  assert.ok(buttons.length>=6);
  for(const [tag,topic] of buttons){
    assert.ok(topics.has(topic),topic);
    assert.match(tag,/aria-label="[^"]+のヘルプ"/);
  }
  // Context-dependent buttons only ever switch between topics that exist.
  assert.match(app,/\$\("modeHelp"\)\.dataset\.help=kind;/);
  for(const kind of ["local","ai","online","history"])assert.ok(topics.has(kind),kind);
  assert.match(app,/\$\("endHelp"\)\.dataset\.help=playing && illegalCandidate\?"illegal":"endgame";/);
});

test("help stacks above the open sheet and Escape closes it first",()=>{
  assert.match(css,/\.help-panel\{z-index:11\}/);
  assert.match(help,/if\(!\$\("helpPanel"\)\.hidden\)closeHelp\(\);else closePanels\(\);/);
  assert.match(app,/function closePanels\(\) \{[^}]*\$\("helpPanel"\)\.hidden=true;/);
  // A local ? keeps its row height: the glyph is small and the tap area comes from ::after.
  assert.match(css,/\.help-button::after\{content:"";position:absolute;inset:-10px\}/);
});

test("a local ? opens only its own topic in a popover beside it",()=>{
  assert.match(html,/<div id="helpPopover" class="help-popover" role="dialog"[^>]*hidden>/);
  assert.match(help,/else openHelpPopover\(button\.dataset\.help,button\);/);
  // The popover copies the sheet's topic, so each explanation is written once,
  // and drops ids so the copy never duplicates an element of the sheet.
  assert.match(help,/const source=\$\("help-"\+topic\);/);
  assert.match(help,/copy\.querySelectorAll\("\[id\]"\)\]\)el\.removeAttribute\("id"\)/);
  // Only the header button opens the whole sheet, with every topic closed.
  assert.match(help,/\$\("helpToggle"\)\.onclick=\(\)=>\$\("helpPanel"\)\.hidden\?openHelp\(\):closeHelp\(\);/);
  assert.match(help,/item\.open=false;/);
  // Escape, a tap elsewhere and closing the sheets all dismiss it.
  assert.match(help,/if\(!\$\("helpPopover"\)\.hidden\)\{closeHelpPopover\(\);return;\}/);
  assert.match(help,/if\(!e\.target\.closest\?\.\("#helpPopover,\[data-help\]"\)\)closeHelpPopover\(false\);/);
  assert.match(app,/function closePanels\(\) \{[^}]*closeHelpPopover\(false\);/);
  assert.match(css,/\.help-popover\{position:fixed;z-index:12;/);
});
