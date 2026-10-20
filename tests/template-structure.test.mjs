import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const VOID=new Set(["area","base","br","col","embed","hr","img","input","link","meta","source","track","wbr"]);

// A stray or missing closing tag silently moves later controls into the wrong
// box (a sheet's start button ended up behind its options), so every element
// of the template must close where it opened.
test("every element in the page template is closed in order",()=>{
  const html=readFileSync(new URL("../src/index.template.html",import.meta.url),"utf8")
    .replace(/<!--[\s\S]*?-->/g,"").replace(/<svg[\s\S]*?<\/svg>/g,"");
  const open=[];
  for(const [,closing,name,selfClosing] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b[^>]*?(\/?)>/g)){
    const tag=name.toLowerCase();
    if(VOID.has(tag) || selfClosing)continue;
    if(!closing){open.push(tag);continue;}
    assert.equal(open.pop(),tag,"</"+tag+"> closes a different element");
  }
  assert.deepEqual(open,[]);
});
