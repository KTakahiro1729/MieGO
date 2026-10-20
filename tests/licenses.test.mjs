import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {build} from "esbuild";
import {renderLicenses} from "../scripts/build-html.mjs";
import {STRONG_NETWORKS} from "../public/strong-networks.mjs";
const notices=readFileSync("THIRD_PARTY_NOTICES.md","utf8");

test("every npm package bundled into the KataGo worker has its notice",async()=>{
  const {metafile}=await build({entryPoints:["src/katago/neural-worker.ts"],bundle:true,format:"esm",platform:"browser",write:false,metafile:true,logLevel:"silent"});
  const packages=new Set(Object.keys(metafile.inputs).map(path=>path.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)?.[1]).filter(Boolean));
  assert.ok(packages.has("@tensorflow/tfjs-core"));
  for(const name of packages)assert.ok(notices.includes("`"+name+"`"),name+" is bundled but not in THIRD_PARTY_NOTICES.md");
});

test("every network 最強 downloads is named next to the KataGo network license",()=>{
  const section=notices.slice(notices.indexOf("## KataGo neural networks"),notices.indexOf("## KataGo\n"));
  assert.match(section,/KataGo Neural Network License/);
  for(const {name} of Object.values(STRONG_NETWORKS))assert.ok(section.includes(name),name);
});

test("the served licenses file starts with MieGO's own MIT license",async()=>{
  const text=await renderLicenses();
  assert.match(text,/^# MieGO\n\nMIT License\n\nCopyright \(c\) 2026 KTakahiro1729/);
  assert.ok(text.includes("# Third-party notices"));
});
