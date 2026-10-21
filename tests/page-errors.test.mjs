// Plays a short game on the real page in Chromium, with ドパガキモード on,
// through a capture, 決着手順, the result and stepping back, and fails on any
// script error or rejected action. Splitting app.mjs into modules can leave a
// name behind that only fails when that code runs (#124 left the ドパガキモード
// cheer calling a reducedMotion that had moved out).
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
// As in scoring-layout.test.mjs: the pull request check must run this; places without Chromium skip it.
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

test("a game with a capture, scoring and stepping back runs without a script error",{skip,timeout:180000},async t=>{
  if(!browser)throw launchError||Error("Playwright is not installed");
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(async()=>{await browser.close();server.close();});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];
  page.on("pageerror",error=>errors.push("pageerror: "+error.message));
  page.on("console",message=>{
    if(message.type()==="error" || /action rejected/.test(message.text()))errors.push(message.type()+": "+message.text());
  });
  await page.addInitScript(()=>localStorage.setItem("miego-dopa","on"));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>typeof document.getElementById("pass").onclick==="function");
  await page.locator("#newGameButton").click();
  await page.locator('input[name="newGameMode"][value="local"]').check({force:true});
  await page.locator("#setupTabBoard").click();
  await page.locator('input[name="boardSize"][value="9"]').check({force:true});
  await page.locator("#startLocal").click();
  await page.locator("#modePanel").waitFor({state:"hidden"});
  // Black takes White's corner stone: (1,0), (0,0), (0,1).
  const board=page.locator("#board");
  for(const [x,y] of [[1,0],[0,0],[0,1]]){
    const box=await board.boundingBox(), gap=box.width/10;
    const move=await page.locator("#moveLabel").textContent();
    await page.mouse.click(box.x+gap*(x+1),box.y+gap*(y+1));
    await page.locator("#confirm:not([disabled])").click();
    await page.waitForFunction(text=>document.getElementById("moveLabel").textContent!==text,move);
  }
  for(let i=0;i<2;i++){
    const move=await page.locator("#moveLabel").textContent();
    await page.locator("#pass").click();
    await page.waitForFunction(text=>document.getElementById("moveLabel").textContent!==text,move);
  }
  await page.locator("#gamePanel.is-scoring").waitFor();
  if(await page.locator("#settleSkip").isVisible())await page.locator("#settleSkip").click();
  await page.waitForFunction(()=>!document.getElementById("agree").disabled,null,{timeout:60000});
  await page.locator("#agree").click();
  await page.locator("#gamePanel.is-finished").waitFor();
  await page.locator("#stepBack").click();
  await page.waitForFunction(()=>document.getElementById("reviewGraphPlot").innerHTML!=="",null,{timeout:30000});
  assert.deepEqual(errors,[]);
  await page.close();
});
