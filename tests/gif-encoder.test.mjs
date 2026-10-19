import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {encodeGif} from "../public/gif-encoder.mjs";

// A small GIF decoder, enough to read back what the encoder writes.
function decodeGif(bytes) {
  assert.equal(String.fromCharCode(...bytes.slice(0,6)),"GIF89a");
  const word=p=>bytes[p]|bytes[p+1]<<8;
  const width=word(6),height=word(8),packed=bytes[10];
  assert.ok(packed&0x80,"global colour table");
  const size=2<<(packed&7);
  const palette=[];
  let p=13;
  for(let i=0;i<size;i++,p+=3)palette.push([bytes[p],bytes[p+1],bytes[p+2]]);
  assert.equal(bytes[p],0x2c);p+=10;
  const minCodeSize=bytes[p++],data=[];
  for(let n=bytes[p++];n;n=bytes[p++]){data.push(...bytes.slice(p,p+n));p+=n;}
  assert.equal(bytes[p],0x3b,"trailer");
  const clear=1<<minCodeSize,end=clear+1,out=[];
  let codeSize=minCodeSize+1,dict=[],prev=null,bit=0;
  const reset=()=>{dict=[];for(let i=0;i<clear;i++)dict[i]=[i];dict[clear]=dict[end]=null;codeSize=minCodeSize+1;prev=null;};
  reset();
  for(;;) {
    let code=0;
    for(let i=0;i<codeSize;i++,bit++)code|=(data[bit>>3]>>(bit&7)&1)<<i;
    if(code===clear){reset();continue;}
    if(code===end)break;
    const entry=code<dict.length?dict[code]:[...prev,prev[0]];
    out.push(...entry);
    if(prev && dict.length<4096)dict.push([...prev,entry[0]]);
    if(dict.length===1<<codeSize && codeSize<12)codeSize++;
    prev=entry;
  }
  return {width,height,palette,indices:out};
}

function image(width,height,colour) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...colour(x,y),255],(y*width+x)*4);
  return {width,height,data};
}

test("few colours survive exactly",()=>{
  const source=image(7,5,(x,y)=>(x+y)%3===0?[255,0,0]:(x+y)%3===1?[0,0,255]:[229,197,140]);
  const {width,height,palette,indices}=decodeGif(encodeGif(source));
  assert.deepEqual([width,height],[7,5]);
  indices.forEach((index,i)=>assert.deepEqual(palette[index],[...source.data.slice(i*4,i*4+3)]));
});

test("a board-sized gradient decodes through code-size growth and table resets",()=>{
  const source=image(720,720,(x,y)=>[x*255/719|0,y*255/719|0,(x*7^y*13)&255]);
  const {width,height,palette,indices}=decodeGif(encodeGif(source));
  assert.deepEqual([width,height],[720,720]);
  assert.equal(indices.length,720*720);
  assert.ok(palette.length<=256);
  let worst=0;
  indices.forEach((index,i)=>{
    for(let c=0;c<3;c++)worst=Math.max(worst,Math.abs(palette[index][c]-source.data[i*4+c]));
  });
  assert.ok(worst<64,"quantisation error "+worst);
});

test("malformed pixels are refused",()=>{
  assert.throws(()=>encodeGif({width:2,height:2,data:new Uint8ClampedArray(3)}),/画像データ/);
});

test("the board can be saved as a GIF from play and from replay",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
  assert.match(html,/id="exportBoardGif" class="secondary full" type="button">盤面をGIFで保存<\/button>/);
  assert.match(html,/id="reviewGif" type="button">盤面をGIFで保存<\/button>/);
  assert.match(app,/\$\("exportBoardGif"\)\.onclick=\(\)=>exportBoardGif\("boardGifNotice"\)/);
  assert.match(app,/\$\("reviewGif"\)\.onclick=\(\)=>exportBoardGif\("reviewNotice"\)/);
  // The canvas already carries the board look and ownership overlay.
  assert.match(app,/canvas\.getContext\("2d"\)\.getImageData\(0,0,canvas\.width,canvas\.height\)/);
});
