import test from "node:test";
import assert from "node:assert/strict";
import { PALETTES,paletteAt,ownershipAlpha,ownershipPixel,paletteGradient,interpolateOwnership } from "../public/territory-view.mjs";

test("monochrome is default, white and black on opposite sides",()=>{
  assert.deepEqual(paletteAt(-1),PALETTES.mono[0]);
  assert.deepEqual(paletteAt(0),PALETTES.mono[1]);
  assert.deepEqual(paletteAt(1),PALETTES.mono[2]);
});
test("neutral is completely transparent in all palettes, with opacity increasing towards extremes",()=>{
  for(const name of Object.keys(PALETTES)){
    assert.equal(ownershipPixel(0,name,.55)[3],0);
    assert.deepEqual(ownershipPixel(-1,name,1),[...PALETTES[name][0],255]);
    assert.deepEqual(ownershipPixel(1,name,1),[...PALETTES[name][2],255]);
    assert.deepEqual(paletteAt(-.01,name),PALETTES[name][0]);
    assert.deepEqual(paletteAt(.01,name),PALETTES[name][2]);
    assert.ok(ownershipAlpha(.05,.55)<ownershipAlpha(.8,.55));
    const gradient=paletteGradient(name,.55);
    assert.match(gradient,/^linear-gradient\(90deg,rgba\(/);
    assert.match(gradient,/0\) 50%,rgba\(.+,0\) 50%/);
    assert.match(gradient,/0\.55\) 100%\)$/);
  }
  assert.equal(ownershipAlpha(-.5,.8),.4);
});
test("opacity slider cannot make neutral visible and inputs are clamped",()=>{
  for(const opacity of [0,.3,1,2,-1,NaN])assert.equal(ownershipPixel(0,"mono",opacity)[3],0);
  assert.equal(ownershipPixel(1,"mono",0)[3],0);
  assert.equal(ownershipAlpha(3,2),1);
  assert.equal(ownershipAlpha(NaN,1),0);
  assert.equal(ownershipAlpha(1,NaN),0);
});
test("field transitions are numeric and preserve inputs",()=>{
  const from=Array(81).fill(-1),to=Array(81).fill(1);
  assert.ok(interpolateOwnership(from,to,.5).every(n=>n===0));
  assert.equal(from[0],-1);assert.equal(to[0],1);
  assert.deepEqual(interpolateOwnership(from,to,-2),from);
  assert.deepEqual(interpolateOwnership(from,to,2),to);
  assert.throws(()=>interpolateOwnership(from,[],.5),/Invalid/);
});
test("six colour-map choices include hiding the overlay",async()=>{
  const {isPaletteChoice,showsOwnership,PALETTE_NONE}=await import("../public/territory-view.mjs");
  assert.equal(Object.keys(PALETTES).length+1,6);
  assert.equal(isPaletteChoice(PALETTE_NONE),true);
  assert.equal(isPaletteChoice("bogus"),false);
  assert.equal(showsOwnership("none"),false);
  assert.equal(showsOwnership("brownTeal"),true);
  const {readFileSync}=await import("node:fs");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.equal((html.match(/name="palette"/g)||[]).length,6);
  assert.doesNotMatch(html,/id="assisted"/);
});
