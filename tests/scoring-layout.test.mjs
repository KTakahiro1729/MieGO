// Drives the real page in Chromium through play, 決着手順, dead-stone check
// and the final result, and measures where things land on screen.
// Regression: the score totals slid under the sticky action row.
import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname,join,normalize} from "node:path";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../public/",import.meta.url));
const TYPES={".html":"text/html",".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",
  ".json":"application/json",".wasm":"application/wasm",".svg":"image/svg+xml",".txt":"text/plain"};
// Portrait phones from docs/UX_POLICY_DRAFT.md §6, then tablet and desktop.
const VIEWPORTS=[[320,568],[375,667],[390,844],[430,932],[768,1024],[1280,720]];
// UX policy §2: the board's size comes first on a portrait screen, so from
// 375×667 up the score box has to fit without shrinking the board. Smaller
// phones and landscape desktops may shrink it rather than hide the score.
const keepsBoard=([w,h])=>h>w && w>=375 && h>=667;

let chromium;
try{({chromium}=await import("playwright"));}catch{}
let browser,launchError;
if(chromium)try{browser=await chromium.launch();}catch(error){launchError=error;}
// The GitHub pull request check installs Chromium and must run this. Other
// places without a downloaded browser (a laptop, the Cloudflare build) skip it.
const skip=!browser && !process.env.GITHUB_ACTIONS?"Chromium is not available (npx playwright install chromium)":false;

const server=createServer(async(request,response)=>{
  const path=new URL(request.url,"http://x").pathname;
  const file=normalize(join(root,path.endsWith("/")?path+"index.html":path));
  if(!file.startsWith(root)){response.writeHead(403).end();return;}
  try{
    response.writeHead(200,{"content-type":TYPES[extname(file)]||"application/octet-stream"});
    response.end(await readFile(file));
  }catch{response.writeHead(404).end();}
});

function layout(page){
  return page.evaluate(()=>{
    const box=id=>{
      const element=document.getElementById(id);
      if(!element || element.closest("[hidden],.hidden"))return null;
      const {top,bottom,left,right,width}=element.getBoundingClientRect();
      return {top,bottom,left,right,width};
    };
    const buttons=[...document.querySelectorAll("#gamePanel button")].filter(button=>
      button.getClientRects().length && !button.closest("[hidden],.hidden,.visually-hidden,details:not([open]) .review-menu-popover"))
      .map(button=>({id:button.id||button.textContent.trim(),className:button.className,...button.getBoundingClientRect().toJSON()}));
    return {height:innerHeight,width:innerWidth,scrolled:document.querySelector(".game-layout").scrollTop,
      topbar:box("boardFrame")&&document.querySelector(".topbar").getBoundingClientRect().bottom,
      board:box("boardFrame"),score:box("scoreBox"),actions:box("actionRow"),buttons};
  });
}

function assertFits(view,phase,size){
  const at=`${size.join("×")} ${phase}`;
  assert.equal(view.scrolled,0,`${at}: the game panel scrolled`);
  assert.ok(view.board.top>=view.topbar-0.5,`${at}: the board is under the header`);
  assert.ok(view.actions.bottom<=view.height+0.5,`${at}: the action row runs off the screen`);
  if(view.score){
    assert.ok(view.score.top>=view.board.bottom,`${at}: the score box overlaps the board`);
    assert.ok(view.score.bottom<=view.actions.top+0.5,
      `${at}: the score box (bottom ${view.score.bottom}) slides under the action row (top ${view.actions.top})`);
  }
  for(const button of view.buttons){
    assert.ok(button.top>=0 && button.bottom<=view.height+0.5 && button.left>=0 && button.right<=view.width+0.5,
      `${at}: button "${button.id}" is off the screen`);
    // UX policy §3.2: every button outside the exceptions is at least 44px tall.
    if(!/\b(help-button|icon-button|move-history-toggle)\b/.test(button.className))assert.ok(button.height>=43.5,
      `${at}: button "${button.id}" is ${button.height}px tall`);
  }
}

test("scoring and the result fit above the action row on every screen",{skip,timeout:240000},async t=>{
  if(!browser)throw launchError||Error("Playwright is not installed");
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await browser.close();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}/`;
  for(const size of VIEWPORTS){
    const page=await browser.newPage({viewport:{width:size[0],height:size[1]}});
    await page.goto(origin);
    await page.locator("#pass").waitFor();
    const playing=await layout(page);
    assertFits(playing,"playing",size);
    for(let i=0;i<2;i++)await page.locator("#pass").click();
    await page.locator("#gamePanel.is-scoring").waitFor();
    const phases=[["決着手順",await layout(page)]];
    if(await page.locator("#settleSkip").isVisible())await page.locator("#settleSkip").click();
    await page.waitForFunction(()=>!document.getElementById("agree").disabled,null,{timeout:60000});
    phases.push(["死石の確認",await layout(page)]);
    await page.locator("#agree").click();
    await page.locator("#gamePanel.is-finished").waitFor();
    phases.push(["対局終了",await layout(page)]);
    for(const [phase,view] of phases){
      assertFits(view,phase,size);
      if(keepsBoard(size))assert.ok(view.board.width>=playing.board.width-0.5,
        `${size.join("×")} ${phase}: the board shrank from ${playing.board.width}px to ${view.board.width}px`);
    }
    await page.close();
  }
});
