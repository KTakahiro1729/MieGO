import test from "node:test";
import assert from "node:assert/strict";
import { countingGradient,countingPalette,countingOpacity,PALETTES,paletteAt,ownershipAlpha,ownershipPixel,paletteGradient,interpolateOwnership,normalizePalette } from "../public/territory-view.mjs";
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
test("neutral is completely transparent in all palettes, with opacity increasing towards extremes",()=>{
  for(const name of Object.keys(PALETTES))for(const theme of THEMES){
    assert.equal(ownershipPixel(0,name,.55,theme)[3],0);
    const full=Math.round(255*PALETTES[name][theme].cap);
    assert.equal(ownershipPixel(-1,name,1,theme)[3],full);
    assert.equal(ownershipPixel(1,name,1,theme)[3],full);
    assert.deepEqual(paletteAt(-1,name,theme),PALETTES[name][theme].white.rgb);
    assert.deepEqual(paletteAt(1,name,theme),PALETTES[name][theme].black.rgb);
    assert.ok(ownershipPixel(-.05,name,.55,theme)[3]<ownershipPixel(-.8,name,.55,theme)[3]);
    assert.ok(ownershipPixel(.05,name,.55,theme)[3]<ownershipPixel(.8,name,.55,theme)[3]);
    const gradient=paletteGradient(name,.55,theme);
    assert.match(gradient,/^linear-gradient\(90deg,rgba\(/);
    assert.match(gradient,/,0\) 50%,/,"neutral centre is transparent");
    assert.match(gradient,/\) 100%\)$/);
  }
});
test("five bands: neutral, leaning (weak colour) and settled (strong colour) on each side",async()=>{
  const {OWNERSHIP_BANDS}=await import("../public/territory-view.mjs");
  const {LEANING,SETTLED,BLEND}=OWNERSHIP_BANDS;
  for(const name of ["orangePurple","greenPurple"])for(const theme of THEMES){
    const {white,black}=PALETTES[name][theme];
    assert.notDeepEqual(white.weak,white.rgb,name+"/"+theme+" white has an inner colour");
    assert.notDeepEqual(black.weak,black.rgb,name+"/"+theme+" black has an inner colour");
    // Inside a band the colour is flat: the band, not the exact value, is shown.
    assert.deepEqual(paletteAt(LEANING+BLEND,name,theme),black.weak);
    assert.deepEqual(paletteAt(SETTLED-BLEND,name,theme),black.weak);
    assert.deepEqual(paletteAt(-(SETTLED+BLEND),name,theme),white.rgb);
    const alpha=v=>ownershipAlpha(v,.8);
    assert.ok(alpha(LEANING-BLEND)<.1,"neutral band is nearly clear");
    assert.ok(Math.abs(alpha(LEANING+BLEND)-alpha(SETTLED-BLEND))<1e-9,"leaning band is flat");
    assert.ok(alpha(LEANING+BLEND)>alpha(LEANING-BLEND)*4,"leaning is clearly visible");
    assert.ok(alpha(SETTLED+BLEND)>alpha(SETTLED-BLEND)+.15,"settled stands out from leaning");
  }
});
test("monochrome keeps one colour per side on a smooth ramp, as before the bands",async()=>{
  const {OWNERSHIP_GAMMA}=await import("../public/territory-view.mjs");
  for(const theme of THEMES){
    const {white,black}=PALETTES.mono[theme];
    for(const v of [.1,.4,.6,.9])assert.deepEqual(paletteAt(v,"mono",theme),black.rgb);
    assert.deepEqual(paletteAt(-.5,"mono",theme),white.rgb);
    const expected=Math.round(255*(1-(1-.5**(1/OWNERSHIP_GAMMA)*.55)**black.gain));
    assert.equal(ownershipPixel(.5,"mono",.55,theme)[3],expected);
  }
});
test("the endgame advisor counts as settled exactly what is drawn in the strong colour",async()=>{
  const {readFileSync}=await import("node:fs");
  const src=readFileSync(new URL("../public/endgame.mjs",import.meta.url),"utf8");
  assert.match(src,/OWNERSHIP_BANDS\.SETTLED/);
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

test("counting legend shows White's area, a neutral ring and Black's area in the chosen map",()=>{
  assert.equal(countingPalette("none"),"mono");
  assert.equal(countingPalette("greenPurple"),"greenPurple");
  assert.equal(countingOpacity(.1),.5);
  assert.equal(countingOpacity(.8),.8);
  const css=countingGradient("orangePurple",.8,"wood");
  assert.match(css,/^radial-gradient\(/);
  assert.match(css,/rgba\(135,50,2,[^)]+\) 0 33%/);
  assert.match(css,/transparent 33% 67%/);
  assert.match(css,/rgba\(107,74,98,[^)]+\) 67% 100%/);
});

test("both sides look equally far from neutral and every step stays apart, on every board look",()=>{
  // CIELAB distance between colours composited on the board's surface.
  const lin=c=>{c/=255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
  const lab=([r,g,b])=>{const R=lin(r),G=lin(g),B=lin(b);
    const f=t=>t>.008856?Math.cbrt(t):7.787*t+16/116;
    const x=f((R*.4124+G*.3576+B*.1805)/.95047),y=f(R*.2126+G*.7152+B*.0722),z=f((R*.0193+G*.1192+B*.9505)/1.08883);
    return [116*y-16,500*(x-y),200*(y-z)];};
  const dE=(a,b)=>{const A=lab(a),B=lab(b);return Math.hypot(A[0]-B[0],A[1]-B[1],A[2]-B[2]);};
  for(const name of ["orangePurple","greenPurple"])for(const theme of THEMES){
    const surface=BOARD_THEMES[theme].surface;
    const on=v=>{const [r,g,b,a]=ownershipPixel(v,name,.55,theme);const k=a/255;
      return [r,g,b].map((c,i)=>c*k+surface[i]*(1-k));};
    const pairs=[[on(-.5),surface],[on(-1),on(-.5)],[on(.5),surface],[on(1),on(.5)],[on(-.5),on(.5)]];
    // Both ends look equally far from neutral, at every opacity.
    for(const opacity of [.3,.55,.8,1])for(const v of [.4,.6,.8,1]){
      const at=x=>{const [r,g,b,a]=ownershipPixel(x,name,opacity,theme);const k=a/255;
        return [r,g,b].map((c,i)=>c*k+surface[i]*(1-k));};
      const w=dE(at(-v),surface),b=dE(at(v),surface);
      assert.ok(Math.max(w,b)/Math.min(w,b)<=1.1,name+"/"+theme+" sides at "+v+"/"+opacity+": "+w.toFixed(1)+" vs "+b.toFixed(1));
    }
    // The fixed grid lines stay visible under every step.
    const css=BOARD_THEMES[theme].line;
    const rgba=css[0]==="#"?[1,3,5].map(i=>parseInt(css.slice(i,i+2),16)).concat(1):css.match(/[\d.]+/g).map(Number);
    const line=rgba.slice(0,3).map((c,i)=>c*rgba[3]+surface[i]*(1-rgba[3]));
    for(const opacity of [.55,1])for(const v of [-1,-.5,.5,1]){
      const [r,g,b,a]=ownershipPixel(v,name,opacity,theme),k=a/255;
      const onLine=[r,g,b].map((c,i)=>c*k+line[i]*(1-k)),onBoard=[r,g,b].map((c,i)=>c*k+surface[i]*(1-k));
      assert.ok(dE(onLine,onBoard)>=(opacity===1?10.5:15.5),name+"/"+theme+" line under "+v+"/"+opacity+": "+dE(onLine,onBoard).toFixed(1));
    }
    for(const [a,b] of pairs)assert.ok(dE(a,b)>=18.5,name+"/"+theme+" step distance "+dE(a,b).toFixed(1));
  }
});
