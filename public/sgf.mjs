import { BLACK, WHITE, BOARD_SIZES, isBoardSize, sizeOf, handicapPoints, maxHandicap, newGame, initialGame, handicapOf, komiOf, play, resume, boardHash } from "./core.mjs";
import { TEXT } from "./texts.mjs";

const MAX_TEXT=512*1024, MAX_NODES=5000, MAX_DEPTH=40, MAX_STEPS=2000;
const esc=value=>String(value??"").replace(/\\/g,"\\\\").replace(/\]/g,"\\]");
// A file or record that cannot be read as a game is reported in one way.
const broken=()=>Error(TEXT.record.broken);
const coord=(position,size)=>position===null?"":String.fromCharCode(
  97+position%size,97+Math.floor(position/size));

function parseTree(text) {
  if(typeof text!=="string" || !text.trim())throw broken();
  if(text.length>MAX_TEXT)throw Error(TEXT.sgf.tooLarge);
  let i=0,nodesRead=0;
  const skip=()=>{while(/\s/.test(text[i]||"") && i<text.length)i++;};
  const parseValue=()=>{
    if(text[i]!=="[")throw broken();
    i++;let value="",ended=false;
    while(i<text.length){
      let c=text[i++];
      if(c==="]"){ended=true;break;}
      if(c==="\\"){
        if(i>=text.length)throw broken();
        c=text[i++];
        if(c==="\r"){if(text[i]==="\n")i++;continue;}
        if(c==="\n")continue;
      }
      value+=c;
    }
    if(!ended)throw broken();
    return value;
  };
  const sequence=depth=>{
    if(depth>MAX_DEPTH)throw Error(TEXT.sgf.tooLong);
    skip();if(text[i++]!=="(")throw broken();
    const nodes=[],children=[];
    skip();
    while(text[i]===";"){
      if(++nodesRead>MAX_NODES)throw Error(TEXT.sgf.tooLong);
      i++;const props=Object.create(null);
      skip();
      while(/[A-Za-z]/.test(text[i]||"")){
        const start=i;while(/[A-Za-z]/.test(text[i]||""))i++;
        const name=text.slice(start,i);
        if(!/^[A-Z]+$/.test(name))throw broken();
        skip();if(text[i]!=="[")throw broken();
        const values=[];while(text[i]==="["){values.push(parseValue());skip();}
        if(props[name])props[name].push(...values);else props[name]=values;
        skip();
      }
      nodes.push(props);skip();
    }
    if(!nodes.length)throw broken();
    while(text[i]==="("){children.push(sequence(depth+1));skip();}
    if(text[i++]!==")")throw broken();
    return {nodes,children};
  };
  skip();const root=sequence(0);skip();
  if(i!==text.length)throw Error(TEXT.sgf.multipleGames);
  return root;
}
function first(root,name) {return root[name]?.[0]??null;}
function decodeMove(value,size){
  // FF[4] keeps "tt" as a pass for boards up to 19x19 (FF[3] compatibility).
  if(value==="" || value==="tt")return null;
  const x=value.charCodeAt(0)-97,y=value.charCodeAt(1)-97;
  if(!/^[a-s]{2}$/.test(value) || x>=size || y>=size)
    throw broken();
  return y*size+x;
}
// SGF primary line only; unsupported setup nodes are rejected rather than misread.
export function parseSGF(text) {
  let tree=parseTree(text);const nodes=[];
  while(tree){nodes.push(...tree.nodes);tree=tree.children[0]||null;}
  const root=nodes[0];
  if(first(root,"GM")!==null && first(root,"GM")!=="1")throw Error(TEXT.sgf.notGo);
  const size=Number(first(root,"SZ"));
  if(!/^\d+$/.test(first(root,"SZ")??"") || !isBoardSize(size))
    throw Error(TEXT.sgf.sizes(BOARD_SIZES.join("・")));
  if(first(root,"FF")!==null && first(root,"FF")!=="4")throw Error(TEXT.sgf.format);
  // Handicap is accepted only as MieGO's fixed star-point placement in the root.
  for(const node of nodes.slice(1))
    if(["AB","AW","AE","PL","HA"].some(prop=>prop in node))
      throw Error(TEXT.sgf.setupMidGame);
  if(["AW","AE"].some(prop=>prop in root))throw Error(TEXT.sgf.setupWhite);
  const placed=(root.AB||[]).map(value=>decodeMove(value,size));
  const handicap=placed.length;
  if(handicap===1 || handicap>maxHandicap(size) ||
     (first(root,"HA")!==null && Number(first(root,"HA"))!==handicap) ||
     placed.some(p=>!handicapPoints(size,handicap).includes(p)) ||
     new Set(placed).size!==handicap)
    throw Error(TEXT.sgf.handicap(maxHandicap(size)));
  if(first(root,"PL")!==null && first(root,"PL")!==(handicap?"W":"B"))
    throw Error(TEXT.sgf.player);
  let state=newGame(true,{handicap,size}),seen=0;
  for(const node of nodes){
    if(("B" in node)&&("W" in node))throw broken();
    const key="B" in node?"B":"W" in node?"W":null;
    if(!key)continue;
    if(++seen>MAX_STEPS)throw Error(TEXT.sgf.tooLong);
    if(node[key].length!==1)throw broken();
    const color=key==="B"?BLACK:WHITE;
    if(state.next!==color)throw Error(TEXT.sgf.wrongOrder(seen));
    if(state.status==="scoring")state=resume(state);
    try{state=play(state,decodeMove(node[key][0],size));}
    catch(error){throw Error(TEXT.sgf.moveError(seen,error.message));}
  }
  const result=first(root,"RE");
  const metadata={
    komi:first(root,"KM")??String(komiOf(state)),
    rules:first(root,"RU")??"Chinese",
    result:result||null,
    blackName:first(root,"PB")||null,
    whiteName:first(root,"PW")||null
  };
  if(!/^-?\d+(?:\.\d+)?$/.test(metadata.komi))
    throw broken();
  if(result && /^(B|W)\+(R|\d+(?:\.\d+)?)$/.test(result))
    state={...state,status:"finished",result};
  return {snapshot:state,metadata,variationsIgnored:hasVariations(parseTree(text)),steps:seen};
}
function hasVariations(tree){
  if(tree.children.length>1)return true;
  return tree.children.some(hasVariations);
}
export function replaySteps(game,through=game.moves.length){
  if(!Array.isArray(game?.moves) || !Number.isInteger(through) || through<0 || through>game.moves.length)
    throw broken();
  let state=initialGame(game);
  for(let i=0;i<through;i++){
    const {color,position}=game.moves[i];
    if(color!==state.next)throw broken();
    if(state.status==="scoring")state=resume(state);
    try { state=play(state,position); }
    catch {throw broken();}
  }
  return state;
}
export function forkReview(game,through) {
  let state=replaySteps(game,through);
  if(state.status==="scoring")state=resume(state);
  if(state.status==="finished"){
    // A resignation is recorded as a terminal event, not as a board move.
    const moves=state.moves.filter(x=>x.position!=="resign");
    state={...state,moves,status:"playing",result:null,passes:0,endProposal:null};
  }
  return {...state,status:"playing",passes:0,result:null,endProposal:null,
    dead:[],agreed:{black:false,white:false},history:[...state.history]};
}
export function exportSGF(record) {
  const snapshot=record?.snapshot||record;
  // Revalidate the move sequence, except that an imported SGF may carry an
  // independent final result/komi that is not computed with MieGO's rules.
  replaySteps(snapshot);
  const meta=record?.sgfMeta||{};
  const label=(key,value)=>value?key+"["+esc(value)+"]":"";
  const size=sizeOf(snapshot.board);
  const moves=snapshot.moves.filter(m=>m.position!=="resign").map(m=>
    ";"+(m.color===BLACK?"B":"W")+"["+coord(m.position,size)+"]").join("");
  const result=meta.result||snapshot.result;
  const handicap=handicapOf(snapshot);
  const setup=handicap?"HA["+handicap+"]AB"+handicapPoints(size,handicap)
    .map(p=>"["+coord(p,size)+"]").join(""):"";
  return "(;GM[1]FF[4]CA[UTF-8]SZ["+size+"]KM["+esc(meta.komi??komiOf(snapshot))+"]RU["+
    esc(meta.rules??"Chinese")+"]"+setup+label("PB",meta.blackName)+
    label("PW",meta.whiteName)+label("RE",result)+moves+")";
}
