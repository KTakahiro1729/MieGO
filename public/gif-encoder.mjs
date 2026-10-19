// A minimal still-image GIF89a encoder. The board mixes wood/sheen gradients,
// anti-aliased stones and the ownership overlay, so the colours are reduced
// to at most 256 by median cut over a 5-bit-per-channel histogram, weighted
// by how many pixels use each colour, and then LZW-compressed.

const BINS = 1<<15;
const binOf = (r,g,b) => (r>>3)<<10 | (g>>3)<<5 | b>>3;

function buildPalette(data, maxColors) {
  const count=new Uint32Array(BINS), sum=new Float64Array(BINS*3);
  for(let p=0;p<data.length;p+=4) {
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
  const lookup=new Uint8Array(BINS);
  for(const bin of used) {
    let nearest=0,distance=Infinity;
    palette.forEach((rgb,i)=>{
      const dr=rgb[0]-channel(bin,0),dg=rgb[1]-channel(bin,1),db=rgb[2]-channel(bin,2);
      const d=dr*dr+dg*dg+db*db;
      if(d<distance){distance=d;nearest=i;}
    });
    lookup[bin]=nearest;
  }
  return {palette,lookup};
}

function lzw(indices, minCodeSize, out) {
  const clear=1<<minCodeSize, end=clear+1;
  let codeSize=minCodeSize+1, next=end+1, dict=new Map();
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
    const k=indices[i], key=prefix<<8|k, hit=dict.get(key);
    if(hit!==undefined){prefix=hit;continue;}
    emit(prefix);
    if(next<4096) {
      dict.set(key,next++);
      if(next>1<<codeSize)codeSize++;
    } else {
      emit(clear);
      dict=new Map();codeSize=minCodeSize+1;next=end+1;
    }
    prefix=k;
  }
  emit(prefix);
  emit(end);
  if(bits>0)block.push(buffer&255);
  if(block.length)flushBlock();
  out.push(0);
}

/** Encodes RGBA pixels (alpha ignored) as a single-frame GIF. */
export function encodeGif({width,height,data}) {
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<1 || height<1 ||
     width>65535 || height>65535 || data?.length!==width*height*4)
    throw Error("画像データが不正です");
  const {palette,lookup}=buildPalette(data,256);
  let depth=1;
  while(1<<depth<palette.length)depth++;
  const indices=new Uint8Array(width*height);
  for(let i=0,p=0;i<indices.length;i++,p+=4)indices[i]=lookup[binOf(data[p],data[p+1],data[p+2])];

  const out=[..."GIF89a"].map(c=>c.charCodeAt(0));
  const word=v=>out.push(v&255,v>>8&255);
  word(width);word(height);
  out.push(0x80|(depth-1)<<4|(depth-1),0,0);
  for(let i=0;i<1<<depth;i++)out.push(...(palette[i]||[0,0,0]));
  out.push(0x2c);word(0);word(0);word(width);word(height);out.push(0);
  lzw(indices,Math.max(2,depth),out);
  out.push(0x3b);
  return Uint8Array.from(out);
}
