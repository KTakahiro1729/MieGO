import test from "node:test";
import assert from "node:assert/strict";
import { PALETTES,paletteAt,paletteGradient,interpolateOwnership } from "../public/territory-view.mjs";

test("monochrome is the default and runs white to black",()=>{
  assert.deepEqual(paletteAt(-1),PALETTES.mono[0]);
  assert.deepEqual(paletteAt(0),PALETTES.mono[1]);
  assert.deepEqual(paletteAt(1),PALETTES.mono[2]);
  assert.ok(paletteAt(-1)[0]>paletteAt(1)[0]);
});
test("named alternatives preserve the ownership direction",()=>{
  for (const name of ["mono","purpleGreen","blueRed"]) {
    assert.deepEqual(paletteAt(-1,name),PALETTES[name][0]);
    assert.deepEqual(paletteAt(1,name),PALETTES[name][2]);
    assert.match(paletteGradient(name),/^linear-gradient\(90deg,rgb\(/);
  }
});
test("out of bounds and invalid values are clamped",()=>{
  assert.deepEqual(paletteAt(-3),paletteAt(-1));
  assert.deepEqual(paletteAt(3),paletteAt(1));
  assert.deepEqual(paletteAt(NaN),paletteAt(0));
});
test("field changes interpolate without modifying inputs",()=>{
  const from=Array(81).fill(-1),to=Array(81).fill(1);
  const halfway=interpolateOwnership(from,to,.5);
  assert.ok(halfway.every(n=>n===0));
  assert.equal(from[0],-1);
  assert.equal(to[0],1);
  assert.deepEqual(interpolateOwnership(from,to,-2),from);
  assert.deepEqual(interpolateOwnership(from,to,2),to);
  assert.throws(()=>interpolateOwnership(from,[],.5),/Invalid/);
});
