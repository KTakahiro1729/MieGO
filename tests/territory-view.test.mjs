import test from "node:test";
import assert from "node:assert/strict";
import { PALETTES,paletteAt,ownershipAlpha,ownershipPixel,paletteGradient,interpolateOwnership,normalizePalette } from "../public/territory-view.mjs";
import { BOARD_THEMES } from "../public/board-theme.mjs";

const THEMES=Object.keys(BOARD_THEMES);

test("monochrome is default on the wood board, white and black on opposite sides",()=>{
  assert.deepEqual(paletteAt(-1),PALETTES.mono.wood.white.rgb);
  assert.deepEqual(paletteAt(1),PALETTES.mono.wood.black.rgb);
  assert.deepEqual(paletteAt(1,"mono","bogus"),PALETTES.mono.wood.black.rgb);
  assert.deepEqual(paletteAt(1,"bogus"),PALETTES.mono.wood.black.rgb);
});
test("every colour map is tuned for every board look",()=>{
  for(const name of Object.keys(PALETTES))
    assert.deepEqual(Object.keys(PALETTES[name]).sort(),[...THEMES].sort());
});
test("purple always stands for Black",()=>{
  const purple=([r,g,b])=>b>g && r>g && b>r*.9;
  for(const name of ["orangePurple","greenPurple"])
    for(const theme of THEMES){
      assert.ok(purple(paletteAt(1,name,theme)),name+"/"+theme+" black side is purple");
      assert.ok(!purple(paletteAt(-1,name,theme)),name+"/"+theme+" white side is not purple");
    }
});
test("neutral is completely transparent in all palettes, with opacity increasing towards extremes",()=>{
  for(const name of Object.keys(PALETTES))for(const theme of THEMES){
    assert.equal(ownershipPixel(0,name,.55,theme)[3],0);
    assert.equal(ownershipPixel(-1,name,1,theme)[3],255);
    assert.equal(ownershipPixel(1,name,1,theme)[3],255);
    assert.deepEqual(paletteAt(-.01,name,theme),PALETTES[name][theme].white.rgb);
    assert.deepEqual(paletteAt(.01,name,theme),PALETTES[name][theme].black.rgb);
    assert.ok(ownershipPixel(-.05,name,.55,theme)[3]<ownershipPixel(-.8,name,.55,theme)[3]);
    assert.ok(ownershipPixel(.05,name,.55,theme)[3]<ownershipPixel(.8,name,.55,theme)[3]);
    const gradient=paletteGradient(name,.55,theme);
    assert.match(gradient,/^linear-gradient\(90deg,rgba\(/);
    assert.match(gradient,/,0\) 50%,rgba\(.+,0\) 50%,/,"neutral centre is transparent");
    assert.match(gradient,/\) 100%\)$/);
  }
});
test("weak leanings are lifted above a linear ramp",()=>{
  assert.ok(ownershipAlpha(.3,.55)>.3*.55);
  assert.equal(ownershipAlpha(1,.55),.55);
  assert.equal(ownershipAlpha(-1,.5,2),.75,"a gain above 1 lifts a side");
  assert.ok(ownershipAlpha(-1,.5,.5)<.5,"a gain below 1 damps a side");
  assert.equal(ownershipAlpha(1,1,.5),1,"full opacity stays full on every side");
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
test("four colour-map choices include hiding the overlay; old choices migrate",async()=>{
  const {isPaletteChoice,showsOwnership,PALETTE_NONE}=await import("../public/territory-view.mjs");
  assert.equal(Object.keys(PALETTES).length+1,4);
  assert.equal(isPaletteChoice(PALETTE_NONE),true);
  assert.equal(isPaletteChoice("bogus"),false);
  assert.equal(showsOwnership("none"),false);
  assert.equal(showsOwnership("greenPurple"),true);
  assert.equal(normalizePalette("purpleGreen"),"greenPurple");
  for(const removed of ["blueRed","brownTeal",null,"bogus"])assert.equal(normalizePalette(removed),"mono");
  assert.equal(normalizePalette("none"),"none");
  const {readFileSync}=await import("node:fs");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  assert.equal((html.match(/name="palette"/g)||[]).length,4);
  for(const theme of THEMES)assert.match(html,new RegExp(`name="boardTheme" value="${theme}"`));
  assert.doesNotMatch(html,/id="assisted"/);
});
