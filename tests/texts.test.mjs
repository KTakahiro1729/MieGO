import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,readdirSync} from "node:fs";
import {TEXT,textAt} from "../public/texts.mjs";
import {renderIndex,renderTemplate} from "../scripts/build-html.mjs";

const JAPANESE=/[ぁ-んァ-ン一-龥]/;
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");

test("public/index.html is the rendered template, so wording lives only in texts.mjs",async()=>{
  assert.equal(read("public/index.html"),await renderIndex(),"run: node scripts/build-html.mjs");
  assert.doesNotMatch(read("src/index.template.html"),JAPANESE);
});

test("client modules take their wording from texts.mjs instead of string literals",()=>{
  const modules=readdirSync(new URL("../public/",import.meta.url))
    .filter(name=>name.endsWith(".mjs") && name!=="texts.mjs" && !name.includes(".bundle."));
  for(const name of modules){
    const code=read("public/"+name).split("\n")
      .filter(line=>!/^\s*(\/\/|\*|\/\*)/.test(line))
      .map(line=>line.replace(/\s\/\/.*$/,""));
    const literal=code.find(line=>/(["'`])[^"'`]*[ぁ-んァ-ン一-龥][^"'`]*\1/.test(line));
    assert.equal(literal,undefined,name);
  }
});

test("template placeholders resolve strings, function calls and lists",()=>{
  assert.equal(renderTemplate("<b>{{help.title}}</b>"),"<b>"+TEXT.help.title+"</b>");
  assert.equal(renderTemplate("{{common.helpFor(help.endgame)}}"),"終局と採点のヘルプ");
  assert.equal(renderTemplate("{{game.moveLabel(0)}}"),"0手目");
  assert.equal(renderTemplate("  {{help.local.items}}"),TEXT.help.local.items.map(item=>"  <li>"+item+"</li>").join("\n"));
  assert.throws(()=>textAt("help.missing"),/Unknown text key/);
});
