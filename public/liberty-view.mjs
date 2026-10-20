import {BLACK, WHITE, group, groups, neighbors, sizeOf} from "./core.mjs";

// 呼吸点の表示: which liberties the board shows, chosen in 設定 and kept in
// localStorage. "candidate" marks only the provisional stone's group and the
// opponent groups it puts in atari; "atari" marks the last liberty of every
// group in atari; "dots" marks every liberty; "count" writes each group's
// number of liberties on one of its stones; "danger" outlines every group
// down to two liberties or one, and while a stone is placed joins its group
// to each of its liberties.
export const LIBERTY_MODES = Object.freeze(["off","candidate","atari","danger","dots","count"]);
export const DEFAULT_LIBERTY_MODE = "off";
export const isLibertyMode = value => LIBERTY_MODES.includes(value);

/**
 * The marks for `board`, as plain data for the renderer:
 * {kind:"dot", position, colors:[BLACK|WHITE,...], atari} for a liberty,
 * {kind:"atari", position} for the last liberty of a group in atari,
 * {kind:"count", position, color, count} for a group's liberty count,
 * {kind:"danger", stones:[...], count} for a group with one or two liberties,
 * {kind:"tube", position, from:[...], color, atari} for a liberty of the
 * placed stone's group and the stones of it that touch the liberty.
 * `placed` is the provisional stone, if any.
 */
export function libertyMarks(board, mode, placed=null) {
  if(!isLibertyMode(mode) || mode==="off")return [];
  if(mode==="candidate"){
    if(!Number.isInteger(placed) || !board[placed])return [];
    const me=board[placed], own=group(board,placed), marks=[];
    for(const p of own.liberties)marks.push({kind:"dot",position:p,colors:[me],atari:own.liberties.size===1});
    const seen=new Set();
    for(const n of neighbors(placed,sizeOf(board))){
      if(board[n]!==-me || seen.has(n))continue;
      const g=group(board,n);
      for(const s of g.stones)seen.add(s);
      if(g.liberties.size===1)marks.push({kind:"atari",position:[...g.liberties][0]});
    }
    return marks;
  }
  const all=[...groups(board)].filter(g=>g.color===BLACK || g.color===WHITE);
  if(mode==="danger"){
    const marks=[];
    for(const g of all.filter(g=>g.liberties.size<=2)){
      marks.push({kind:"danger",stones:[...g.stones],count:g.liberties.size});
      if(g.liberties.size===1)marks.push({kind:"atari",position:[...g.liberties][0]});
    }
    if(Number.isInteger(placed) && board[placed]){
      const own=group(board,placed), size=sizeOf(board);
      for(const p of own.liberties)marks.push({kind:"tube",position:p,color:board[placed],atari:own.liberties.size===1,
        from:neighbors(p,size).filter(n=>own.stones.has(n))});
    }
    return marks;
  }
  if(mode==="atari")
    return [...new Set(all.filter(g=>g.liberties.size===1).map(g=>[...g.liberties][0]))]
      .map(position=>({kind:"atari",position}));
  if(mode==="count")
    return all.map(g=>({kind:"count",position:labelStone(g,sizeOf(board)),color:g.color,count:g.liberties.size}));
  const dots=new Map();
  for(const g of all)for(const p of g.liberties){
    const dot=dots.get(p) || {kind:"dot",position:p,colors:[],atari:false};
    if(!dot.colors.includes(g.color))dot.colors.push(g.color);
    dot.atari ||= g.liberties.size===1;
    dots.set(p,dot);
  }
  return [...dots.values()].map(dot=>({...dot,colors:dot.colors.sort((a,b)=>b-a)}));
}

// The stone nearest the group's middle carries its count.
function labelStone(g, size) {
  const stones=[...g.stones];
  const cx=stones.reduce((s,p)=>s+p%size,0)/stones.length;
  const cy=stones.reduce((s,p)=>s+Math.floor(p/size),0)/stones.length;
  const d=p=>(p%size-cx)**2+(Math.floor(p/size)-cy)**2;
  return stones.reduce((a,b)=>d(b)<d(a)?b:a);
}
