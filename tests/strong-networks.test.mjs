// The networks 最強 downloads load in the same KataGo reader the page uses
// and return a legal-shaped policy. The build fetches them (npm pretest); a
// place that could not reach a network's host skips it.
import test from "node:test";
import assert from "node:assert/strict";
import {existsSync,readFileSync,mkdtempSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {STRONG_NETWORKS} from "../public/strong-networks.mjs";

const repo=fileURLToPath(new URL("..",import.meta.url));
const parts=key=>{
  const dir=join(repo,"public/models",key);
  if(!existsSync(join(dir,"parts.json")))return null;
  const manifest=JSON.parse(readFileSync(join(dir,"parts.json"),"utf8"));
  return {manifest,bytes:Buffer.concat(manifest.parts.map(part=>readFileSync(join(dir,part.path))))};
};

let probe;
async function loadProbe(){
  if(probe)return probe;
  const {build}=await import("esbuild");
  const dir=mkdtempSync(join(tmpdir(),"miego-probe-"));
  const entry=join(dir,"probe.ts"),out=join(dir,"probe.cjs");
  const k=join(repo,"vendor/web-katrain/src/engine/katago");
  writeFileSync(entry,`
import * as tf from "@tensorflow/tfjs";
import { ungzip } from "pako";
import { setBoardSize } from ${JSON.stringify(k+"/fastBoard")};
import { fillInputsV7FastForPosition } from ${JSON.stringify(k+"/positionInputsV7")};
import { parseKataGoModelV8 } from ${JSON.stringify(k+"/loadModelV8")};
import { KataGoModelV8Tf } from ${JSON.stringify(k+"/modelV8")};
import { toKataGoPosition } from ${JSON.stringify(join(repo,"src/katago/position.mjs"))};
import { newGame, whiteCompensation, rulesOf } from ${JSON.stringify(join(repo,"public/core.mjs"))};
export async function topMove(gz: Uint8Array, size: number) {
  await tf.setBackend("cpu");
  const parsed = parseKataGoModelV8(ungzip(gz));
  if (parsed.metaEncoderVersion !== 0) throw new Error("metadata model");
  const model = new KataGoModelV8Tf(parsed);
  const state = newGame(true, { size });
  const { size: s, ...pos } = toKataGoPosition(state);
  setBoardSize(s);
  const sp = new Float32Array(s * s * 22), gl = new Float32Array(19);
  fillInputsV7FastForPosition({ ...pos, komi: whiteCompensation(state), rules: rulesOf(state),
    conservativePassAndIsRoot: true, outSpatial: sp, outGlobal: gl });
  const out = model.forward(tf.tensor4d(sp, [1, s, s, 22]), tf.tensor2d(gl, [1, 19]));
  const raw = await out.policy.data();
  const ch = model.policyOutChannels;
  const policy = Array.from({ length: s * s }, (_, p) => raw[p * ch]);
  return { length: policy.length, finite: policy.every(Number.isFinite), best: policy.indexOf(Math.max(...policy)) };
}
`);
  await build({entryPoints:[entry],outfile:out,bundle:true,platform:"node",format:"cjs",logLevel:"error",
    nodePaths:[join(repo,"node_modules")]});
  const {createRequire}=await import("node:module");
  probe=createRequire(import.meta.url)(out);
  process.on("exit",()=>rmSync(dir,{recursive:true,force:true}));
  return probe;
}

for(const [key,network] of Object.entries(STRONG_NETWORKS)){
  const found=parts(key);
  test("最強's "+key+" network loads and plays a move",{skip:!found && "not downloaded here"},async()=>{
    assert.equal(createHash("sha256").update(found.bytes).digest("hex"),network.sha256);
    for(const part of found.manifest.parts)assert.ok(part.bytes<=25*1024*1024,"Cloudflare's 25 MiB file limit");
    const {topMove}=await loadProbe();
    const result=await topMove(new Uint8Array(found.bytes),key==="kata9x9"?9:13);
    assert.equal(result.length,key==="kata9x9"?81:169);
    assert.ok(result.finite);
  });
}
