import test from "node:test";
import assert from "node:assert/strict";
import {source} from "./helpers/source.mjs";
const html=source("index.html"),app=source("app.mjs"),css=source("style.css");
const sheet=html.slice(html.indexOf('<aside id="helpPanel"'),html.indexOf('</aside>',html.indexOf('<aside id="helpPanel"')));
const topics=new Set([...sheet.matchAll(/<details id="help-([\w-]+)"/g)].map(m=>m[1]));

test("the header reads 新規対戦, share, help, then the settings gear at the end",()=>{
  const header=html.slice(html.indexOf('class="header-actions"'),html.indexOf('</header>'));
  const order=["newGameButton","shareToggle","helpToggle","settingsToggle"].map(id=>header.indexOf('id="'+id+'"'));
  assert.ok(order.every((at,i)=>at>=0&&(i===0||order[i-1]<at)),order.join());
  for(const label of ["共有を開く","ヘルプを開く","設定を開く"])
    assert.match(header,new RegExp('aria-label="'+label+'" title="'+label+'"'),"icon buttons name themselves on hover too");
  assert.match(header,/id="helpToggle" class="icon-button"[^>]*aria-label="ヘルプを開く"[^>]*aria-controls="helpPanel"/);
});

test("explanations live in the help sheet instead of being scattered",()=>{
  assert.match(sheet,/role="dialog" aria-modal="true" aria-labelledby="helpTitle"/);
  for(const topic of ["beginner","endgame","scoring","illegal","ownership","rules","local","ai","online","history","about"])
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
  assert.match(app,/if\(view\.help\)\$\("endHelp"\)\.dataset\.help=view\.help;/);
  for(const topic of ["endgame","illegal"])assert.ok(topics.has(topic),topic);
  assert.match(app,/dataset\.help=gomoku\?"rules":"scoring";/);
  for(const topic of ["rules","scoring"])assert.ok(topics.has(topic),topic);
  // The rules shown above the board are plain text with the usual ? beside them.
  assert.match(html,/<span id="ruleLabel" class="rule-label">[^<]+<\/span><button class="help-button" type="button" data-help="rules"/);
});

test("help stacks above the open sheet and Escape closes it first",()=>{
  assert.match(css,/\.help-panel\{z-index:11\}/);
  assert.match(app,/function closePanels\(\) \{[^}]*\$\("helpPanel"\)\.hidden=true;/);
  // A local ? keeps its row height: the glyph is small and the tap area comes from ::after.
  assert.match(css,/\.help-button::after\{content:"";position:absolute;inset:-10px\}/);
});

test("a local ? opens only its own topic in a popover beside it",()=>{
  assert.match(html,/<div id="helpPopover" class="help-popover" role="dialog"[^>]*hidden>/);
  assert.match(app,/function closePanels\(\) \{[^}]*closeHelpPopover\(false\);/);
  assert.match(css,/\.help-popover\{position:fixed;z-index:12;/);
});
