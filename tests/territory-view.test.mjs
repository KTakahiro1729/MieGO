import test from "node:test";
import assert from "node:assert/strict";
import { countingGradient,countingPalette,countingOpacity,PALETTES,paletteAt,ownershipAlpha,ownershipPixel,paletteGradient,
  interpolateOwnership,normalizePalette,OWNERSHIP_BANDS,PALETTE_CUSTOM,COLOUR_KEYS,paletteColours,setCustomColours,
  setOpacityShape,opacityShape,isPaletteChoice,showsOwnership,PALETTE_NONE } from "../public/territory-view.mjs";
import {source} from "./helpers/source.mjs";

test("monochrome is the default: the stones' own colours, white and black on opposite sides",()=>{
  assert.deepEqual(Object.keys(PALETTES),["mono","greenPurple"]);
  assert.deepEqual(paletteColours("custom"),{whiteSettled:"#e66101",whiteLeaning:"#fdb863",blackLeaning:"#92c5de",blackSettled:"#0571b0"},
    "the custom map starts from the colour-blind-safe blue-orange pair");
  assert.deepEqual(paletteAt(-1),PALETTES.mono.white.rgb);
  assert.deepEqual(paletteAt(1),PALETTES.mono.black.rgb);
  assert.deepEqual(paletteAt(.5),PALETTES.mono.black.rgb,"one colour per side");
  assert.deepEqual(paletteAt(1,"bogus"),PALETTES.mono.black.rgb);
});
test("each side shows its leaning colour below SETTLED and its settled colour beyond",()=>{
  const {SETTLED,BLEND}=OWNERSHIP_BANDS;
  for(const name of Object.keys(PALETTES)){
    const {white,black}=PALETTES[name];
    assert.deepEqual(paletteAt(SETTLED-BLEND,name),black.weak);
    assert.deepEqual(paletteAt(-(SETTLED+BLEND),name),white.rgb);
    assert.deepEqual(paletteAt(.01,name),black.weak);
  }
  for(const name of Object.keys(PALETTES)){
    const lightness=([r,g,b])=>.2126*r+.7152*g+.0722*b;
    if(name==="mono")continue;
    assert.ok(lightness(PALETTES[name].white.weak)>lightness(PALETTES[name].white.rgb),name+" White leaning is lighter");
    assert.ok(lightness(PALETTES[name].black.weak)>lightness(PALETTES[name].black.rgb),name+" Black leaning is lighter");
  }
});
test("opacity has one curve for both sides, V or U shaped, topped by the opacity slider",()=>{
  try{
    for(const name of Object.keys(PALETTES))for(const v of [.1,.3,.5,.8,1])
      assert.equal(ownershipPixel(-v,name,.7)[3],ownershipPixel(v,name,.7)[3],name+" symmetric at "+v);
    assert.equal(setOpacityShape("V"),"V");
    assert.equal(ownershipAlpha(.5,.8),.4,"V: proportional to the lean");
    assert.equal(setOpacityShape("U"),"U");
    assert.ok(Math.abs(ownershipAlpha(.5,.8)-.2)<1e-12,"U: faint while open");
    assert.equal(ownershipAlpha(1,.8),.8,"both reach the slider's maximum");
    assert.equal(setOpacityShape("bogus"),"V");
    assert.equal(opacityShape(),"V");
  }finally{setOpacityShape("V");}
});
test("neutral is completely transparent and inputs are clamped",()=>{
  for(const name of Object.keys(PALETTES)){
    assert.equal(ownershipPixel(0,name,.55)[3],0);
    assert.equal(ownershipPixel(1,name,1)[3],255);
    const gradient=paletteGradient(name,.55);
    assert.match(gradient,/^linear-gradient\(90deg,rgba\(/);
    assert.match(gradient,/,0\) 50%,/,"neutral centre is transparent");
  }
  for(const opacity of [0,.3,1,2,-1,NaN])assert.equal(ownershipPixel(0,"mono",opacity)[3],0);
  assert.equal(ownershipAlpha(3,2),1);
  assert.equal(ownershipAlpha(NaN,1),0);
  assert.equal(ownershipAlpha(1,NaN),0);
});
test("the player's own colours make the custom map, shared by every drawing",()=>{
  assert.equal(isPaletteChoice(PALETTE_CUSTOM),true);
  assert.equal(setCustomColours({whiteSettled:"#ffffff"}),false,"all four colours are needed");
  assert.equal(setCustomColours({whiteSettled:"#ff0000",whiteLeaning:"#ff8080",blackLeaning:"#8080ff",blackSettled:"bad"}),false);
  const chosen={whiteSettled:"#ff0000",whiteLeaning:"#ff8080",blackLeaning:"#8080ff",blackSettled:"#0000ff"};
  assert.equal(setCustomColours(chosen),true);
  assert.deepEqual(paletteColours(PALETTE_CUSTOM),chosen);
  assert.deepEqual(paletteAt(-1,PALETTE_CUSTOM),[255,0,0]);
  assert.deepEqual(paletteAt(.3,PALETTE_CUSTOM),[128,128,255]);
  assert.deepEqual(COLOUR_KEYS,["whiteSettled","whiteLeaning","blackLeaning","blackSettled"]);
  assert.equal(paletteColours("greenPurple").whiteSettled,"#00b373");
});
test("field transitions are numeric and preserve inputs",()=>{
  const from=Array(81).fill(-1),to=Array(81).fill(1);
  assert.ok(interpolateOwnership(from,to,.5).every(n=>n===0));
  assert.equal(from[0],-1);assert.equal(to[0],1);
  assert.deepEqual(interpolateOwnership(from,to,-2),from);
  assert.deepEqual(interpolateOwnership(from,to,2),to);
  assert.throws(()=>interpolateOwnership(from,[],.5),/Invalid/);
});
test("colour-map choices: presets, custom and hiding the overlay; old choices migrate",async()=>{
  assert.equal(isPaletteChoice(PALETTE_NONE),true);
  assert.equal(isPaletteChoice("bogus"),false);
  assert.equal(showsOwnership("none"),false);
  assert.equal(normalizePalette("purpleGreen"),"greenPurple");
  for(const removed of ["blueRed","brownTeal","orangePurple","blueOrange",null,"bogus"])assert.equal(normalizePalette(removed),"mono");
  assert.equal(normalizePalette("custom"),"custom");
  const html=source("index.html");
  for(const name of [...Object.keys(PALETTES),"custom","none"])assert.match(html,new RegExp(`name="palette" value="${name}"`));
  for(const key of COLOUR_KEYS)assert.match(html,new RegExp(`type="color" id="colour-${key}"`));
  assert.match(html,/name="opacityShape" value="V"/);
  assert.match(html,/name="opacityShape" value="U"/);
});
test("counting legend shows White's area, a neutral ring and Black's area in the chosen map",()=>{
  assert.equal(countingPalette("none"),"mono");
  assert.equal(countingPalette("custom"),"custom");
  assert.equal(countingOpacity(.1),.5);
  assert.equal(countingOpacity(.8),.8);
  const css=countingGradient("greenPurple",.8);
  assert.match(css,/^radial-gradient\(/);
  assert.match(css,/rgba\(0,179,115,0\.8\) 0 33%/);
  assert.match(css,/transparent 33% 67%/);
  assert.match(css,/rgba\(202,105,200,0\.8\) 67% 100%/);
});
test("the endgame advisor counts as settled exactly what is drawn in the settled colour",async()=>{
  assert.match(source("endgame.mjs"),/OWNERSHIP_BANDS\.SETTLED/);
});
