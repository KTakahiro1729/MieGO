import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createGifAnimation} from "../public/gif-encoder.mjs";

// A small GIF decoder, enough to read back what the encoder writes.
function decodeGif(bytes) {
  assert.equal(String.fromCharCode(...bytes.slice(0,6)),"GIF89a");
  const word=p=>bytes[p]|bytes[p+1]<<8;
  const width=word(6),height=word(8),packed=bytes[10];
  assert.ok(packed&0x80,"global colour table");
  const size=2<<(packed&7),palette=[];
  let p=13;
  for(let i=0;i<size;i++,p+=3)palette.push([bytes[p],bytes[p+1],bytes[p+2]]);
  const canvas=new Array(width*height).fill(null),frames=[];
  let delay=0,loops=false;
  while(bytes[p]!==0x3b) {
    if(bytes[p]===0x21) {
      const label=bytes[p+1];
      if(label===0xf9)delay=word(p+4);
      if(label===0xff)loops=String.fromCharCode(...bytes.slice(p+3,p+14))==="NETSCAPE2.0";
      p+=2;
      for(let n=bytes[p++];n;n=bytes[p++])p+=n;
      continue;
    }
    assert.equal(bytes[p],0x2c,"image descriptor");
    const left=word(p+1),top=word(p+3),w=word(p+5),h=word(p+7);p+=10;
    const minCodeSize=bytes[p++],data=[];
    for(let n=bytes[p++];n;n=bytes[p++]){data.push(...bytes.slice(p,p+n));p+=n;}
    const indices=lzwDecode(data,minCodeSize);
    assert.equal(indices.length,w*h);
    indices.forEach((index,i)=>{canvas[(top+Math.floor(i/w))*width+left+i%w]=palette[index];});
    frames.push({rect:[left,top,w,h],delay,pixels:canvas.slice()});
  }
  return {width,height,palette,frames,loops};
}
function lzwDecode(data,minCodeSize) {
  const clear=1<<minCodeSize,end=clear+1,out=[];
  let codeSize,dict,prev,bit=0;
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
  return out;
}

function image(width,height,colour) {
  const data=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)data.set([...colour(x,y),255],(y*width+x)*4);
  return data;
}
const rgb=(data,i)=>[...data.slice(i*4,i*4+3)];

test("few colours survive exactly",()=>{
  const data=image(7,5,(x,y)=>(x+y)%3===0?[255,0,0]:(x+y)%3===1?[0,0,255]:[229,197,140]);
  const gif=createGifAnimation({width:7,height:5,paletteFrom:[data]});
  gif.addFrame(data,100);
  const {width,height,frames}=decodeGif(gif.finish());
  assert.deepEqual([width,height],[7,5]);
  frames[0].pixels.forEach((pixel,i)=>assert.deepEqual(pixel,rgb(data,i)));
});

test("a board-sized gradient decodes through code-size growth and table resets",()=>{
  const data=image(720,720,(x,y)=>[x*255/719|0,y*255/719|0,(x*7^y*13)&255]);
  const gif=createGifAnimation({width:720,height:720,paletteFrom:[data]});
  gif.addFrame(data,10);
  const {palette,frames}=decodeGif(gif.finish());
  assert.ok(palette.length<=256);
  let worst=0;
  frames[0].pixels.forEach((pixel,i)=>{
    for(let c=0;c<3;c++)worst=Math.max(worst,Math.abs(pixel[c]-data[i*4+c]));
  });
  assert.ok(worst<64,"quantisation error "+worst);
});

test("animation frames store only the changed rectangle and loop forever",()=>{
  const blank=image(6,6,()=>[200,170,120]);
  const stone=image(6,6,(x,y)=>x===4&&y===1?[0,0,0]:[200,170,120]);
  const gif=createGifAnimation({width:6,height:6,paletteFrom:[blank,stone]});
  gif.addFrame(blank,90);
  gif.addFrame(stone,45);
  gif.addFrame(stone,45); // unchanged: lengthens the previous frame
  gif.addFrame(blank,300);
  const {frames,loops}=decodeGif(gif.finish());
  assert.ok(loops);
  assert.deepEqual(frames.map(f=>f.rect),[[0,0,6,6],[4,1,1,1],[4,1,1,1]]);
  assert.deepEqual(frames.map(f=>f.delay),[90,90,300]);
  assert.deepEqual(frames[1].pixels[1*6+4],[0,0,0]);
  assert.deepEqual(frames[2].pixels[1*6+4],[200,170,120]);
});

test("colours missing from the palette sources map to the nearest entry",()=>{
  const white=image(2,2,()=>[255,255,255]),black=image(2,2,()=>[0,0,0]);
  const gif=createGifAnimation({width:2,height:2,paletteFrom:[white,black]});
  gif.addFrame(white,10);
  gif.addFrame(image(2,2,()=>[30,20,25]),10);
  assert.deepEqual(decodeGif(gif.finish()).frames[1].pixels[0],[0,0,0]);
});

test("malformed input is refused",()=>{
  assert.throws(()=>createGifAnimation({width:2,height:2,paletteFrom:[new Uint8ClampedArray(3)]}),/画像データ/);
  const gif=createGifAnimation({width:1,height:1,paletteFrom:[image(1,1,()=>[0,0,0])]});
  assert.throws(()=>gif.finish(),/フレーム/);
});

test("the share sheet makes a still PNG or a game GIF and shares or saves it",()=>{
  const app=readFileSync(new URL("../public/app.mjs",import.meta.url),"utf8");
  assert.match(app,/\$\("shareImage"\)\.onclick=\(\)=>void shareImage\(\)/);
  assert.match(app,/target\.toBlob\([^)]*\)[^;]*"image\/png"/);
  assert.match(app,/buildGameAnimation\(/);
  // Share where the device can take the file, otherwise save it.
  assert.match(app,/canShareFile\(file\)\?"SNSで共有":"画像を保存"/);
  assert.match(app,/navigator\.share\(\{files:\[file\]\}\)/);
});
