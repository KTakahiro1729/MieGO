// 効果音 and ドパガキモード switched in every order: before a game, during
// one and after a reload, by mouse and by finger. Drives the real page in
// Chromium and counts the audio sources each move starts.
import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname,join,normalize} from "node:path";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../public/",import.meta.url));
const TYPES={".html":"text/html",".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",
  ".json":"application/json",".wasm":"application/wasm",".svg":"image/svg+xml",".txt":"text/plain"};

let chromium;
try{({chromium}=await import("playwright"));}catch{}
let browser,launchError;
if(chromium)try{browser=await chromium.launch({args:["--autoplay-policy=user-gesture-required"]});}catch(error){launchError=error;}
const skip=!browser && !process.env.GITHUB_ACTIONS?"Chromium is not available (npx playwright install chromium)":false;

const server=createServer(async(request,response)=>{
  const path=new URL(request.url,"http://x").pathname;
  const file=normalize(join(root,path.endsWith("/")?path+"index.html":path));
  if(!file.startsWith(root)){response.writeHead(403).end();return;}
  let body;
  try{body=await readFile(file);}catch{response.writeHead(404).end();return;}
  response.writeHead(200,{"content-type":TYPES[extname(file)]||"application/octet-stream"});
  response.end(body);
});

// Counts every audio source started, and keeps the context the page made.
function listen(){
  window.heard={starts:0,context:null};
  const Context=window.AudioContext;
  window.AudioContext=class extends Context{constructor(...args){super(...args);window.heard.context=this;}};
  const start=AudioScheduledSourceNode.prototype.start;
  AudioScheduledSourceNode.prototype.start=function(...args){window.heard.starts++;return start.apply(this,args);};
}

// S: 効果音, D: ドパガキモード, X: 初期状態に戻す (which leaves both as they are),
// G: a new 二人で対局, M: a move, R: a reload.
const ORDERS=["SGMM","DSGMDMM","GMSMDMDMSMSM","SDRGMM","SGMRMDMRM","DGMSMDM","SDGMXMM"];
const POINTS=[[2,2],[6,6],[2,6],[6,2],[4,4],[3,5],[5,3]];

test("every move sounds while 効果音 is on, whatever order the switches went in",{skip,timeout:180000},async t=>{
  if(!browser)throw launchError||Error("Playwright is not installed");
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await browser.close();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}/`;
  for(const touch of [false,true])for(const order of ORDERS){
    const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:touch,isMobile:touch});
    await context.addInitScript(listen);
    const page=await context.newPage();
    const ready=()=>page.waitForFunction(()=>typeof document.getElementById("pass").onclick==="function");
    const press=selector=>touch?page.locator(selector).tap():page.locator(selector).click();
    const settings=async id=>{
      await press("#settingsToggle");
      await page.locator("#settingsPanel").waitFor({state:"visible"});
      await press(id);
      await press("#closeSettings");
    };
    const moveNumber=()=>page.evaluate(()=>Number(/(\d+)手目/.exec(document.body.innerText)?.[1]));
    await page.goto(origin);await ready();
    let on=false,played=0;
    for(const [step,letter] of [...order].entries()){
      const at=`${touch?"finger":"mouse"} ${order} step ${step+1}`;
      if(letter==="S"){await settings("#soundEffects");on=!on;}
      if(letter==="D")await settings("#dopaMode");
      if(letter==="X")await settings("#resetAppearance");
      if(letter==="R"){await page.reload();await ready();}
      if(letter==="G"){
        await press("#newGameButton");
        await page.locator("#modePanel").waitFor({state:"visible"});
        await page.locator("input[name=newGameMode][value=local]").evaluate(input=>(input.closest("label")??input).click());
        await press("#startLocal");
      }
      if(letter!=="M")continue;
      const before=await page.evaluate(()=>window.heard.starts);
      const number=await moveNumber();
      const board=await page.locator("#board").boundingBox();
      // The 9路 grid runs from a tenth of the board to nine tenths.
      const [x,y]=POINTS[played++];
      const point={x:board.x+board.width*(.1+.1*x),y:board.y+board.height*(.1+.1*y)};
      if(touch)await page.touchscreen.tap(point.x,point.y);else await page.mouse.click(point.x,point.y);
      await press("#confirm");
      await page.waitForFunction(n=>Number(/(\d+)手目/.exec(document.body.innerText)?.[1])===n+1,number);
      await page.waitForTimeout(150);
      const after=await page.evaluate(()=>({starts:window.heard.starts,state:window.heard.context?.state}));
      assert.equal(after.starts>before,on,`${at}: the move ${on?"was silent":"made a sound"} (audio ${after.state})`);
    }
    await context.close();
  }
});
