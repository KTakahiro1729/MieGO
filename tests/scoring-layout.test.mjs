// Drives the real page in Chromium through play, 決着手順, dead-stone check
// and the final result, and measures where things land on screen.
// Regression: the score totals slid under the sticky action row.
import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname,join,normalize} from "node:path";
import {fileURLToPath} from "node:url";
import {availableParallelism} from "node:os";

const root=fileURLToPath(new URL("../public/",import.meta.url));
const TYPES={".html":"text/html",".mjs":"text/javascript",".js":"text/javascript",".css":"text/css",
  ".json":"application/json",".wasm":"application/wasm",".svg":"image/svg+xml",".txt":"text/plain"};
// Portrait phones from docs/UX_SPEC.md §6, then tablet and desktop.
const VIEWPORTS=[[320,568],[375,667],[390,844],[430,932],[768,1024],[1280,720]];
// UX policy §2: the board's size comes first on a portrait screen, so the
// score box has to fit where the endgame bar was, without shrinking the
// board, under either rules. Landscape desktops may shrink it instead.
const keepsBoard=([w,h])=>h>w;

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
  // Read first: once the 200 is sent, a missing file can no longer answer 404.
  let body;
  try{body=await readFile(file);}catch{response.writeHead(404).end();return;}
  response.writeHead(200,{"content-type":TYPES[extname(file)]||"application/octet-stream"});
  response.end(body);
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
    // Everything stacked under the board, top to bottom, that is on screen now.
    const stack=["boardFrame","ownershipLegend","captureCounts","endgameBar","scoreBox","actionRow"]
      .map(id=>({id,...box(id)})).filter(part=>part.top!==undefined);
    return {height:innerHeight,width:innerWidth,scrolled:document.querySelector(".game-layout").scrollTop,
      // The header's own items: on a PC they sit beside the board, not above it.
      header:[...document.querySelectorAll(".brand,.header-actions")].map(e=>e.getBoundingClientRect().toJSON()),
      board:box("boardFrame"),actions:box("actionRow"),stack,buttons,
      // Text cut off with an ellipsis, by its id or class.
      // The turn sentence is only read out while the row names both players.
      cut:["turn","scoreInstruction"].map(id=>document.getElementById(id)).filter(e=>!e.closest(".has-players"))
        .concat([...document.querySelectorAll("#scoreBox strong,#scoreText .score-detail,#players:not([hidden]) .player-name,#players:not([hidden]) .player-detail-text")])
        .filter(e=>e.getClientRects().length && e.scrollWidth>e.clientWidth+0.5)
        .map(e=>(e.id||e.className)+": "+e.textContent),
      scoreCard:(style=>style.borderTopWidth!=="0px" || style.backgroundColor!=="rgba(0, 0, 0, 0)")(
        getComputedStyle(document.getElementById("scoreBox")))};
  });
}

function assertFits(view,phase,where){
  const at=`${where} ${phase}`;
  assert.equal(view.scrolled,0,`${at}: the game panel scrolled`);
  for(const item of view.header)assert.ok(item.bottom<=view.board.top+0.5 || item.right<=view.board.left+0.5 || item.left>=view.board.right-0.5,
    `${at}: the header runs into the board`);
  assert.ok(view.actions.bottom<=view.height+0.5,`${at}: the action row runs off the screen`);
  // UX principles §1: the score box is not a card, so its frame never adds lines
  // next to the prisoner pills or the action row.
  assert.equal(view.scoreCard,false,`${at}: the score box is drawn as a card`);
  // UX policy §3.5: text fits its slot; nothing hides behind an ellipsis.
  assert.deepEqual(view.cut,[],`${at}: text is cut off`);
  // Nothing under the board runs into the next part: the score box sliding
  // under the action row, or the prisoner pills touching the score box.
  view.stack.slice(1).forEach((part,i)=>{
    const above=view.stack[i];
    assert.ok(part.top>=above.bottom-0.5,
      `${at}: ${part.id} (top ${part.top}) overlaps ${above.id} (bottom ${above.bottom})`);
  });
  for(const button of view.buttons){
    assert.ok(button.top>=0 && button.bottom<=view.height+0.5 && button.left>=0 && button.right<=view.width+0.5,
      `${at}: button "${button.id}" is off the screen`);
    // UX policy §3.2: every button outside the exceptions is at least 44px tall.
    if(!/\b(help-button|icon-button)\b/.test(button.className))assert.ok(button.height>=43.5,
      `${at}: button "${button.id}" is ${button.height}px tall`);
  }
}

// Names the screen and what the page shows when a step never happens.
async function step(page,at,label,action){
  try{return await action();}catch(error){
    const state=await page.evaluate(()=>["gamePanel","turn","moveLabel","endStatus","scoreInstruction"]
      .map(id=>id+"="+JSON.stringify(id==="gamePanel"?document.getElementById(id).className:
        document.getElementById(id).textContent)).join(" ")).catch(()=>"(page gone)");
    throw Error(`${at} ${label}: ${error.message.split("\n")[0]} | ${state}`);
  }
}

test("scoring and the result fit above the action row on every screen",{skip,timeout:720000},async t=>{
  if(!browser)throw launchError||Error("Playwright is not installed");
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await browser.close();server.close();});
  const origin=`http://127.0.0.1:${server.address().port}/`;
  // Japanese rules add the prisoner pills above the score box.
  const queue=[{rules:"chinese",board:"9"},{rules:"chinese",board:"19"},{rules:"japanese",board:"19"}]
    .flatMap(game=>VIEWPORTS.map(size=>({...game,size})));
  // Each screen is its own page whose KataGo runs on one CPU thread, so
  // several play at once: one after another took three minutes on CI.
  await Promise.all(Array.from({length:Math.min(availableParallelism(),queue.length)},async()=>{
    while(queue.length)await playThrough(queue.shift());
  }));
  async function playThrough({rules,board,size}){
    const at=`${size.join("×")} ${rules} ${board}路`;
    const page=await browser.newPage({viewport:{width:size[0],height:size[1]}});
    await page.goto(origin);
    // The button is in the HTML before app.mjs has wired it up.
    await step(page,at,"app start",()=>page.waitForFunction(()=>typeof document.getElementById("pass").onclick==="function"));
    // Two people on one device, so two passes go straight to scoring.
    await page.locator("#newGameButton").click();
    await page.locator('input[name="newGameMode"][value="local"]').check({force:true});
    // 盤 and ルール each have a tab over the one panel of choices.
    // The start button stays over the bottom of the sheet, so each choice is scrolled to the middle first.
    for(const [tab,input] of [["#setupTabBoard",`input[name="boardSize"][value="${board}"]`],["#setupTabRules",`input[name="gameRules"][value="${rules}"]`]]){
      await page.locator(tab).click();
      await page.locator(input).evaluate(el=>el.closest("label").scrollIntoView({block:"center"}));
      await page.locator(input).check({force:true});
    }
    await page.locator("#startLocal").click();
    await step(page,at,"local game",()=>page.locator("#modePanel").waitFor({state:"hidden"}));
    const playing=await layout(page);
    assertFits(playing,"playing",at);
    for(const pass of ["first pass","second pass"]){
      const move=await page.locator("#moveLabel").textContent();
      await page.locator("#pass").click();
      await step(page,at,pass,()=>page.waitForFunction(text=>document.getElementById("moveLabel").textContent!==text,move));
    }
    await step(page,at,"scoring",()=>page.locator("#gamePanel.is-scoring").waitFor());
    const phases=[["決着手順",await layout(page)]];
    if(await page.locator("#settleSkip").isVisible())await page.locator("#settleSkip").click();
    await step(page,at,"dead-stone check",()=>page.waitForFunction(()=>!document.getElementById("agree").disabled,null,{timeout:60000}));
    phases.push(["死石の確認",await layout(page)]);
    await page.locator("#agree").click();
    // Japanese rules then fill territory with the prisoners and ask again.
    if(rules==="japanese"){
      await step(page,at,"counting",()=>page.waitForFunction(()=>!document.getElementById("backToDead").hidden &&
        !document.getElementById("agree").disabled));
      phases.push(["地の計算",await layout(page)]);
      await page.locator("#agree").click();
    }
    await step(page,at,"result",()=>page.locator("#gamePanel.is-finished").waitFor());
    phases.push(["対局終了",await layout(page)]);
    for(const [phase,view] of phases){
      assertFits(view,phase,at);
      if(keepsBoard(size))assert.ok(view.board.width>=playing.board.width-0.5,
        `${at} ${phase}: the board shrank from ${playing.board.width}px to ${view.board.width}px`);
    }
    await page.close();
  }
});
