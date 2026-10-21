import test from "node:test";
import assert from "node:assert/strict";
import { countingGradient,countingPalette,countingOpacity,PALETTES,paletteAt,ownershipAlpha,ownershipPixel,paletteGradient,
  interpolateOwnership,normalizePalette,OWNERSHIP_BANDS,PALETTE_CUSTOM,COLOUR_KEYS,paletteColours,setCustomColours,
  setOpacityShape,opacityShape,isPaletteChoice,showsOwnership,shownOwnership,PALETTE_NONE } from "../public/territory-view.mjs";
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
  // Each colour has a dot on the ramp and a row of swatches for カスタム.
  for(const key of COLOUR_KEYS)assert.match(html,new RegExp(`id="colour-${key}"[^>]*>[^]*id="paletteColour-${key}"`));
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

// 9x9: a White wall on column 3, a Black wall on column 5, dame between.
function walledBoard() {
  const board=Array(81).fill(0),values=Array(81).fill(0);
  for(let y=0;y<9;y++){
    board[y*9+3]=-1;values[y*9+3]=-.9;
    board[y*9+5]=1;values[y*9+5]=.9;
    for(const x of [0,1,2])values[y*9+x]=-.3;
    for(const x of [6,7,8])values[y*9+x]=.4;
  }
  return {board,values};
}
test("an area closed by one side's living stones, and given to it, is shown as settled",()=>{
  const {board,values}=walledBoard();
  const shown=shownOwnership(board,values);
  assert.equal(shown[4*9+1],-1,"White's closed area");
  assert.equal(shown[4*9+7],1,"Black's closed area");
  assert.equal(shown[4*9+4],0,"dame between both walls stays as estimated");
  assert.equal(shown[4*9+3],-.9,"stones keep their estimate");
  assert.equal(values[4*9+1],-.3,"the estimate itself is not changed");
});
test("dead stones inside an area do not open it; doubt keeps the estimate",()=>{
  const dead=walledBoard();
  dead.board[4*9+1]=1;dead.values[4*9+1]=.05; // A Black stone the estimate gives to White on average.
  dead.board[4*9+2]=1;dead.values[4*9+2]=-.5;
  assert.equal(shownOwnership(dead.board,dead.values)[0],-1);
  assert.equal(shownOwnership(dead.board,dead.values)[4*9+1],-1,"the dead stone's point is White's");
  const seki=walledBoard();
  for(let y=0;y<9;y++)seki.values[y*9+3]=-.4;
  assert.equal(shownOwnership(seki.board,seki.values)[0],-.3,"a wall the estimate doubts (seki) closes nothing");
  const doubt=walledBoard();
  doubt.values[8*9]=.1;
  assert.equal(shownOwnership(doubt.board,doubt.values)[0],-.3,"a point given to the other side keeps the area open");
  const open=Array(81).fill(0),lean=Array(81).fill(.3);
  open[40]=1;lean[40]=.9;
  assert.deepEqual(shownOwnership(open,lean),lean,"the open board is never settled");
});
test("日本式 leaves living stones clear and colours a dead stone's point",()=>{
  const {board,values}=walledBoard();
  board[4*9+1]=1;values[4*9+1]=-.6;
  const shown=shownOwnership(board,values,{japanese:true});
  assert.equal(shown[4*9+3],0,"a living White stone");
  assert.equal(shown[4*9+5],0,"a living Black stone");
  assert.equal(shown[4*9+1],-1,"a dead stone's point is territory once lifted");
  assert.equal(shown[4*9+4],0);
});
