// A minimal animated GIF89a encoder. The board mixes wood/sheen gradients,
// anti-aliased stones and the ownership overlay, so the colours are reduced
// to at most 256 by median cut over a 5-bit-per-channel histogram, weighted
// by how many pixels use each colour, and then LZW-compressed.

const BINS = 1<<15;
const binOf = (r,g,b) => (r>>3)<<10 | (g>>3)<<5 | b>>3;

function buildPalette(sources, maxColors) {
  const count=new Uint32Array(BINS), sum=new Float64Array(BINS*3);
  for(const data of sources)for(let p=0;p<data.length;p+=4) {
    const bin=binOf(data[p],data[p+1],data[p+2]);
    count[bin]++;
    sum[bin*3]+=data[p];sum[bin*3+1]+=data[p+1];sum[bin*3+2]+=data[p+2];
  }
  const used=[];
  for(let bin=0;bin<BINS;bin++)if(count[bin])used.push(bin);
  const channel=(bin,c)=>sum[bin*3+c]/count[bin];
  const describe=bins=>{
    let total=0,widest=0,axis=0;
    for(let c=0;c<3;c++) {
      let lo=255,hi=0;
      for(const bin of bins){const v=channel(bin,c);if(v<lo)lo=v;if(v>hi)hi=v;}
      if(hi-lo>widest){widest=hi-lo;axis=c;}
    }
    for(const bin of bins)total+=count[bin];
    return {bins,total,widest,axis};
  };
  const boxes=[describe(used)];
  while(boxes.length<maxColors) {
    // Split where the most pixels see the widest colour spread.
    let pick=-1,best=0;
    boxes.forEach((box,i)=>{
      const score=box.total*box.widest;
      if(box.bins.length>1 && score>best){best=score;pick=i;}
    });
    if(pick<0)break;
    const {bins,total,axis}=boxes[pick];
    bins.sort((a,b)=>channel(a,axis)-channel(b,axis));
    let seen=0,cut=1;
    for(;cut<bins.length-1;cut++){seen+=count[bins[cut-1]];if(seen>=total/2)break;}
    boxes.splice(pick,1,describe(bins.slice(0,cut)),describe(bins.slice(cut)));
  }
  const palette=boxes.map(({bins,total})=>{
    const rgb=[0,0,0];
    for(const bin of bins)for(let c=0;c<3;c++)rgb[c]+=sum[bin*3+c];
    return rgb.map(v=>Math.round(v/total));
  });
  // Colours absent from the sources (later animation frames) are matched on demand.
  const lookup=new Int16Array(BINS).fill(-1);
  const nearest=bin=>{
    const r=(bin>>10)*8+4,g=(bin>>5&31)*8+4,b=(bin&31)*8+4;
    let index=0,distance=Infinity;
    palette.forEach((rgb,i)=>{
      const d=(rgb[0]-r)**2+(rgb[1]-g)**2+(rgb[2]-b)**2;
      if(d<distance){distance=d;index=i;}
    });
    return index;
  };
  for(const bin of used) {
    let index=0,distance=Infinity;
    palette.forEach((rgb,i)=>{
      const dr=rgb[0]-channel(bin,0),dg=rgb[1]-channel(bin,1),db=rgb[2]-channel(bin,2);
      const d=dr*dr+dg*dg+db*db;
      if(d<distance){distance=d;index=i;}
    });
    lookup[bin]=index;
  }
  const indexPixels=data=>{
    const indices=new Uint8Array(data.length/4);
    for(let i=0,p=0;i<indices.length;i++,p+=4) {
      const bin=binOf(data[p],data[p+1],data[p+2]);
      if(lookup[bin]<0)lookup[bin]=nearest(bin);
      indices[i]=lookup[bin];
    }
    return indices;
  };
  return {palette,indexPixels};
}

// prefix code × next index → code; 4096×256 entries, reset on each clear code.
const dict=new Int16Array(4096*256);
function lzw(indices, minCodeSize, out) {
  const clear=1<<minCodeSize, end=clear+1;
  let codeSize=minCodeSize+1, next=end+1;
  dict.fill(-1);
  let buffer=0, bits=0, block=[];
  const flushBlock=()=>{out.push(block.length,...block);block=[];};
  const emit=code=>{
    buffer|=code<<bits;bits+=codeSize;
    while(bits>=8){
      block.push(buffer&255);buffer>>>=8;bits-=8;
      if(block.length===255)flushBlock();
    }
  };
  out.push(minCodeSize);
  emit(clear);
  let prefix=indices[0];
  for(let i=1;i<indices.length;i++) {
    const k=indices[i], key=prefix<<8|k, hit=dict[key];
    if(hit>=0){prefix=hit;continue;}
    emit(prefix);
    if(next<4096) {
      dict[key]=next++;
      if(next>1<<codeSize)codeSize++;
    } else {
      emit(clear);
      dict.fill(-1);codeSize=minCodeSize+1;next=end+1;
    }
    prefix=k;
  }
  emit(prefix);
  emit(end);
  if(bits>0)block.push(buffer&255);
  if(block.length)flushBlock();
  out.push(0);
}

function checkSize(width,height) {
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 ||
     width>65535 || height>65535)throw Error("画像データが不正です");
}
function checkPixels(data,width,height) {
  if(data?.length!==width*height*4)throw Error("画像データが不正です");
}

function startFile(width,height,palette) {
  let depth=1;
  while(1<<depth<palette.length)depth++;
  const out=[..."GIF89a"].map(c=>c.charCodeAt(0));
  const word=v=>out.push(v&255,v>>8&255);
  word(width);word(height);
  out.push(0x80|(depth-1)<<4|(depth-1),0,0);
  for(let i=0;i<1<<depth;i++)out.push(...(palette[i]||[0,0,0]));
  const image=(left,top,w,h,indices)=>{
    out.push(0x2c);word(left);word(top);word(w);word(h);out.push(0);
    lzw(indices,Math.max(2,depth),out);
  };
  return {out,word,image};
}

/**
 * A looping animation built one frame at a time, so a long game never holds
 * every frame in memory. The shared palette comes from `paletteFrom`, which
 * should cover the colours of the whole animation (e.g. a few frames spread
 * across it). Each frame stores only the rectangle that changed; an unchanged
 * frame just lengthens the previous one. Delays are in hundredths of a second.
 */
export function createGifAnimation({width,height,paletteFrom}) {
  checkSize(width,height);
  paletteFrom.forEach(data=>checkPixels(data,width,height));
  const {palette,indexPixels}=buildPalette(paletteFrom,256);
  const {out,word,image}=startFile(width,height,palette);
  // NETSCAPE2.0: loop forever.
  out.push(0x21,0xff,11,...[..."NETSCAPE2.0"].map(c=>c.charCodeAt(0)),3,1,0,0,0);
  let previous=null,pending=null,done=false;
  const flush=()=>{
    if(!pending)return;
    // Graphic control: leave each frame in place for the next to draw over.
    out.push(0x21,0xf9,4,1<<2);word(Math.min(65535,pending.delay));out.push(0,0);
    image(pending.left,pending.top,pending.width,pending.height,pending.indices);
    pending=null;
  };
  return {
    addFrame(data,delay) {
      if(done)throw Error("アニメーションは完成済みです");
      checkPixels(data,width,height);
      const indices=indexPixels(data);
      let left=0,top=0,right=width-1,bottom=height-1;
      if(previous) {
        left=width;top=height;right=-1;bottom=-1;
        for(let y=0;y<height;y++)for(let x=0,i=y*width;x<width;x++,i++) {
          if(indices[i]===previous[i])continue;
          if(x<left)left=x;if(x>right)right=x;
          if(y<top)top=y;bottom=y;
        }
        if(right<0){pending.delay+=delay;return;}
      }
      flush();
      const w=right-left+1,h=bottom-top+1,rect=new Uint8Array(w*h);
      for(let y=0;y<h;y++)rect.set(indices.subarray((top+y)*width+left,(top+y)*width+left+w),y*w);
      pending={left,top,width:w,height:h,indices:rect,delay};
      previous=indices;
    },
    finish() {
      if(!pending)throw Error("フレームがありません");
      flush();done=true;
      out.push(0x3b);
      return Uint8Array.from(out);
    }
  };
}
