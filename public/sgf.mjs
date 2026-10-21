import {
  BLACK,
  BOARD_SIZES,
  boardHash,
  handicapOf,
  handicapPoints,
  hasGomokuForbidden,
  initialGame,
  isBoardSize,
  isFree,
  isGomoku,
  komiOf,
  maxHandicap,
  newGame,
  play,
  replayMove,
  resume,
  rulesOf,
  sizeOf,
  WHITE,
} from "./core.mjs";
import { TEXT } from "./texts.mjs";
import { UserError } from "./user-error.mjs";

const MAX_TEXT=512*1024, MAX_NODES=5000, MAX_DEPTH=40, MAX_STEPS=2000;
const esc=value=>String(value??"").replace(/\\/g,"\\\\").replace(/\]/g,"\\]");
// A file or record that cannot be read as a game is reported in one way.
const broken=()=>Error("Broken record");
const coord=(position,size)=>position===null?"":String.fromCharCode(
  97+position%size,97+Math.floor(position/size));

function parseTree(text) {
  if(typeof text!=="string" || !text.trim())throw broken();
  if(text.length>MAX_TEXT)throw new UserError(TEXT.sgf.tooLarge);
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
    if(depth>MAX_DEPTH)throw new UserError(TEXT.sgf.tooLong);
    skip();if(text[i++]!=="(")throw broken();
    const nodes=[],children=[];
    skip();
    while(text[i]===";"){
      if(++nodesRead>MAX_NODES)throw new UserError(TEXT.sgf.tooLong);
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
  if(i!==text.length)throw new UserError(TEXT.sgf.multipleGames);
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
  // GM[4] is Gomoku/Renju, replayed as MieGO's free-style 五目並べ.
  const gomoku=first(root,"GM")==="4";
  if(first(root,"GM")!==null && first(root,"GM")!=="1" && !gomoku)throw new UserError(TEXT.sgf.notGo);
  const size=Number(first(root,"SZ"));
  if(!/^\d+$/.test(first(root,"SZ")??"") || !isBoardSize(size))
    throw new UserError(TEXT.sgf.sizes(BOARD_SIZES.join("・")));
  if(first(root,"FF")!==null && first(root,"FF")!=="4")throw new UserError(TEXT.sgf.format);
  // Handicap is accepted only as MieGO's fixed star-point placement in the root.
  for(const node of nodes.slice(1))
    if(["AB","AW","AE","PL","HA"].some(prop=>prop in node))
      throw new UserError(TEXT.sgf.setupMidGame);
  const placed=(root.AB||[]).map(value=>decodeMove(value,size));
  const handicap=placed.length;
  const handicapSetup=!(handicap===1 || handicap>maxHandicap(size) ||
     (first(root,"HA")!==null && Number(first(root,"HA"))!==handicap) ||
     placed.some(p=>!handicapPoints(size,handicap).includes(p)) ||
     new Set(placed).size!==handicap);
  // A position without moves (MieGO's 自由に置く, or a problem set up in other
  // software) opens as a free board holding its stones.
  const hasMoves=nodes.some(node=>"B" in node || "W" in node);
  if(!gomoku && !hasMoves && !("AE" in root) &&
     (/^\s*free\b/i.test(first(root,"RU")??"") || "AW" in root || !handicapSetup))
    return parseFreePosition(root,size);
  if(["AW","AE"].some(prop=>prop in root))throw new UserError(TEXT.sgf.setupWhite);
  if(gomoku && handicap)throw new UserError(TEXT.sgf.setupGomoku);
  if(!handicapSetup)throw new UserError(TEXT.sgf.handicap(maxHandicap(size)));
  if(first(root,"PL")!==null && first(root,"PL")!==(handicap?"W":"B"))
    throw new UserError(TEXT.sgf.player);
  // Japanese (and Korean) territory rules are replayed as Japanese; anything else as Chinese.
  const rules=gomoku?"gomoku":
    /^\s*(japanese|korean|jp|ja|kr)\b/i.test(first(root,"RU")??"")?"japanese":"chinese";
  // RU[Renju] on a GM[4] record is 五目並べ with Black's forbidden moves.
  const gomokuForbidden=gomoku && /^\s*renju\b/i.test(first(root,"RU")??"");
  let state=newGame(true,{gomokuForbidden,handicap,size,rules}),seen=0;
  for(const node of nodes){
    if(("B" in node)&&("W" in node))throw broken();
    const key="B" in node?"B":"W" in node?"W":null;
    if(!key)continue;
    if(++seen>MAX_STEPS)throw new UserError(TEXT.sgf.tooLong);
    if(node[key].length!==1)throw broken();
    const color=key==="B"?BLACK:WHITE;
    // After a count, the side that moves first is the one the resumer asked.
    if(state.status==="scoring")state=resume(state,-color);
    if(state.next!==color)throw new UserError(TEXT.sgf.wrongOrder(seen));
    try{state=play(state,decodeMove(node[key][0],size));}
    catch{throw new UserError(TEXT.sgf.illegalMove(seen));}
  }
  const result=first(root,"RE");
  const metadata={
    komi:first(root,"KM")??String(komiOf(state)),
    rules:first(root,"RU")??(gomoku?"Gomoku":rules==="japanese"?"Japanese":"Chinese"),
    result:result||null,
    blackName:first(root,"PB")||null,
    whiteName:first(root,"PW")||null
  };
  if(!/^-?\d+(?:\.\d+)?$/.test(metadata.komi))
    throw broken();
  // 0 (持碁) and Void (無勝負) end a game too.
  if(result && /^(B|W)\+(R|\d+(?:\.\d+)?)$|^(0|Void)$/.test(result))
    state={...state,status:"finished",result};
  return {snapshot:state,metadata,variationsIgnored:hasVariations(parseTree(text)),steps:seen};
}
function parseFreePosition(root,size){
  let state=newGame(true,{rules:"free",size});
  for(const [key,color] of [["AB",BLACK],["AW",WHITE]])
    for(const value of root[key]||[]){
      const position=decodeMove(value,size);
      if(position===null || state.board[position])throw broken();
      state=replayMove(state,{color,position});
    }
  if(state.moves.length>MAX_STEPS)throw new UserError(TEXT.sgf.tooLong);
  const metadata={komi:first(root,"KM")??"0",rules:first(root,"RU")??"Free",result:null,
    blackName:first(root,"PB")||null,whiteName:first(root,"PW")||null};
  return {snapshot:state,metadata,variationsIgnored:false,steps:state.moves.length};
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
    const move=game.moves[i];
    // After a count, the side that moves first is the one the resumer asked.
    if(state.status==="scoring")state=resume(state,-move.color);
    if(move.color!==BLACK && move.color!==WHITE)throw broken();
    try { state=replayMove(state,move); }
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
  if(isFree(snapshot))return exportFreePosition(snapshot,meta);
  const label=(key,value)=>value?key+"["+esc(value)+"]":"";
  const size=sizeOf(snapshot.board);
  const moves=snapshot.moves.filter(m=>m.position!=="resign").map(m=>
    ";"+(m.color===BLACK?"B":"W")+"["+coord(m.position,size)+"]").join("");
  const result=meta.result||snapshot.result;
  const handicap=handicapOf(snapshot);
  const setup=handicap?"HA["+handicap+"]AB"+handicapPoints(size,handicap)
    .map(p=>"["+coord(p,size)+"]").join(""):"";
  // SGF game type 4 is Gomoku/Renju, which has no komi or Go ruleset.
  const head=isGomoku(snapshot)?"(;GM[4]FF[4]CA[UTF-8]SZ["+size+"]"+(hasGomokuForbidden(snapshot)?"RU[Renju]":""):
    "(;GM[1]FF[4]CA[UTF-8]SZ["+size+"]KM["+esc(meta.komi??komiOf(snapshot))+"]RU["+
    esc(meta.rules??(rulesOf(snapshot)==="japanese"?"Japanese":"Chinese"))+"]";
  return head+setup+label("PB",meta.blackName)+
    label("PW",meta.whiteName)+label("RE",result)+moves+")";
}
/** A free board is saved as the position on it, in setup stones, which any SGF reader can show. */
function exportFreePosition(snapshot,meta){
  const size=sizeOf(snapshot.board);
  const stones=color=>snapshot.board.flatMap((v,p)=>v===color?["["+coord(p,size)+"]"]:[]).join("");
  const black=stones(BLACK),white=stones(WHITE);
  return "(;GM[1]FF[4]CA[UTF-8]SZ["+size+"]RU[Free]"+(black?"AB"+black:"")+(white?"AW"+white:"")+")";
}
