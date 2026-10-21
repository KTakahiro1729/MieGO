// PC幅: the phone's column, only bigger. Drives the real page in Chromium and
// measures the board, the rows under it and the sheets beside it.
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
if(chromium)try{browser=await chromium.launch();}catch(error){launchError=error;}
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

const box=(page,selector)=>page.locator(selector).evaluate(e=>e.getBoundingClientRect().toJSON());
const apart=(a,b)=>a.right<=b.left+0.5 || b.right<=a.left+0.5 || a.bottom<=b.top+0.5 || b.bottom<=a.top+0.5;

test("on a PC the board grows into the header's height and the sheets open beside it",{skip,timeout:120000},async t=>{
  if(!browser)throw launchError||Error("Playwright is not installed");
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await browser.close();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}/`;
  // The header row took 68px, so the board was the height less 326px.
  for(const [width,height] of [[1280,800],[1440,900],[1920,1080]]){
    const at=`${width}×${height}`;
    const page=await browser.newPage({viewport:{width,height}});
    await page.goto(origin);
    // The button is in the HTML before app.mjs has wired it up.
    await page.waitForFunction(()=>typeof document.getElementById("pass").onclick==="function");
    const board=await box(page,"#boardFrame");
    assert.ok(board.width>=Math.min(675,height-326+50)-0.5,`${at}: the board is ${board.width}px`);
    // One column: the rows under the board are as wide as the board. The action
    // row reaches 2px past it on each side, room for its buttons' glow.
    for(const [row,bleed] of [["#infoPanel",0],["#actionRow",2]]){
      const part=await box(page,row);
      assert.ok(Math.abs(part.left+bleed-board.left)<1 && Math.abs(part.right-bleed-board.right)<1,`${at}: ${row} is not the board's width`);
    }
    for(const item of [".brand",".header-actions"])
      assert.ok(apart(await box(page,item),board),`${at}: ${item} runs into the board`);
    for(const [button,sheet] of [["#settingsToggle","#settingsPanel"],["#newGameButton","#modePanel"]]){
      await page.locator(button).click();
      await page.locator(sheet).waitFor({state:"visible"});
      const panel=await box(page,sheet);
      assert.ok(apart(panel,board),`${at}: ${sheet} covers the board`);
      assert.ok(panel.width>=320 && panel.right<=width,`${at}: ${sheet} is ${panel.width}px wide`);
      await page.keyboard.press("Escape");
      await page.locator(sheet).waitFor({state:"hidden"});
    }
    await page.close();
  }
});
