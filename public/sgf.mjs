import { BLACK, WHITE, SIZE, KOMI, newGame, play, resume, boardHash } from "./core.mjs";

const MAX_TEXT=512*1024, MAX_NODES=5000, MAX_DEPTH=40, MAX_STEPS=2000;
const esc=value=>String(value??"").replace(/\\/g,"\\\\").replace(/\]/g,"\\]");
const coord=position=>position===null?"":String.fromCharCode(
  97+position%SIZE,97+Math.floor(position/SIZE));

function parseTree(text) {
  if(typeof text!=="string" || !text.trim() || text.length>MAX_TEXT)
    throw Error("SGFファイルが空か、大きすぎます（上限512KB）。");
  let i=0,nodesRead=0;
  const skip=()=>{while(/\s/.test(text[i]||"") && i<text.length)i++;};
  const parseValue=()=>{
    if(text[i]!=="[")throw Error("SGFの値が不正です。");
    i++;let value="",ended=false;
    while(i<text.length){
      let c=text[i++];
      if(c==="]"){ended=true;break;}
      if(c==="\\"){
        if(i>=text.length)throw Error("SGFの末尾に不正なエスケープがあります。");
        c=text[i++];
        if(c==="\r"){if(text[i]==="\n")i++;continue;}
        if(c==="\n")continue;
      }
      value+=c;
    }
    if(!ended)throw Error("SGFのプロパティが閉じられていません。");
    return value;
  };
  const sequence=depth=>{
    if(depth>MAX_DEPTH)throw Error("SGFの分岐が深すぎます。");
    skip();if(text[i++]!=="(")throw Error("SGFは括弧で囲まれた棋譜が必要です。");
    const nodes=[],children=[];
    skip();
    while(text[i]===";"){
      if(++nodesRead>MAX_NODES)throw Error("SGFの節点が多すぎます。");
      i++;const props=Object.create(null);
      skip();
      while(/[A-Za-z]/.test(text[i]||"")){
        const start=i;while(/[A-Za-z]/.test(text[i]||""))i++;
        const name=text.slice(start,i);
        if(!/^[A-Z]+$/.test(name))throw Error("SGFのプロパティ名が不正です。");
        skip();if(text[i]!=="[")throw Error("SGFプロパティの値がありません。");
        const values=[];while(text[i]==="["){values.push(parseValue());skip();}
        if(props[name])props[name].push(...values);else props[name]=values;
        skip();
      }
      nodes.push(props);skip();
    }
    if(!nodes.length)throw Error("SGFの節点がありません。");
    while(text[i]==="("){children.push(sequence(depth+1));skip();}
    if(text[i++]!==")")throw Error("SGFの閉じ括弧がありません。");
    return {nodes,children};
  };
  skip();const root=sequence(0);skip();
  if(i!==text.length)throw Error("複数対局を含むSGFには対応していません。");
  return root;
}
function first(root,name) {return root[name]?.[0]??null;}
function decodeMove(value){
  if(value==="")return null;
  if(!/^[a-i]{2}$/.test(value))throw Error("9路盤以外の座標を検出しました。");
  return (value.charCodeAt(1)-97)*SIZE+(value.charCodeAt(0)-97);
}
// SGF primary line only; unsupported setup nodes are rejected rather than misread.
export function parseSGF(text) {
  let tree=parseTree(text);const nodes=[];
  while(tree){nodes.push(...tree.nodes);tree=tree.children[0]||null;}
  const root=nodes[0];
  if(first(root,"GM")!==null && first(root,"GM")!=="1")throw Error("囲碁以外のSGFは読み込めません。");
  if(first(root,"SZ")!=="9")throw Error("9路盤のSGF（SZ[9]）だけに対応しています。");
  if(first(root,"FF")!==null && first(root,"FF")!=="4")throw Error("SGF形式FF[4]にのみ対応しています。");
  for(const node of nodes)
    if(["AB","AW","AE","PL","HA"].some(prop=>prop in node))
      throw Error("置き石・盤面編集を含むSGFには対応していません。");
  let state=newGame(),seen=0;
  for(const node of nodes){
    if(("B" in node)&&("W" in node))throw Error("同じ節点に白黒両方の着手があります。");
    const key="B" in node?"B":"W" in node?"W":null;
    if(!key)continue;
    if(++seen>MAX_STEPS)throw Error("手順が多すぎます。");
    if(node[key].length!==1)throw Error("SGFの着手が重複しています。");
    const color=key==="B"?BLACK:WHITE;
    if(state.next!==color)throw Error(seen+"手目：黒白の着手順が正しくありません。");
    if(state.status==="scoring")state=resume(state);
    if(state.status!=="playing")throw Error("終局後に着手があります。");
    try{state=play(state,decodeMove(node[key][0]));}
    catch(error){throw Error(seen+"手目："+error.message);}
  }
  const result=first(root,"RE");
  const metadata={
    komi:first(root,"KM")??String(KOMI),
    rules:first(root,"RU")??"Chinese",
    result:result||null,
    blackName:first(root,"PB")||null,
    whiteName:first(root,"PW")||null
  };
  if(!/^-?\d+(?:\.\d+)?$/.test(metadata.komi))
    throw Error("SGFのコミ値が不正です。");
  if(result && /^(B|W)\+(R|\d+(?:\.\d+)?)$/.test(result))
    state={...state,status:"finished",result};
  return {snapshot:state,metadata,variationsIgnored:hasVariations(parseTree(text)),steps:seen};
}
function hasVariations(tree){
  if(tree.children.length>1)return true;
  return tree.children.some(hasVariations);
}
export function replaySteps(game,through=game.moves.length){
  if(!game || !Array.isArray(game.moves))throw Error("棋譜の手順がありません。");
  if(!Number.isInteger(through)||through<0||through>game.moves.length)
    throw Error("指定された手順がありません。");
  let state=newGame(game.assisted!==false);
  for(let i=0;i<through;i++){
    const {color,position}=game.moves[i];
    if(color!==state.next)throw Error((i+1)+"手目の手番が一致しません。");
    if(state.status==="scoring")state=resume(state);
    try { state=play(state,position); }
    catch(error){throw Error((i+1)+"手目："+error.message);}
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
  if(!snapshot || !Array.isArray(snapshot.moves))throw Error("書き出す棋譜がありません。");
  // Revalidate the move sequence, except that an imported SGF may carry an
  // independent final result/komi that is not computed with MieGO's rules.
  replaySteps(snapshot);
  const meta=record?.sgfMeta||{};
  const label=(key,value)=>value?key+"["+esc(value)+"]":"";
  const moves=snapshot.moves.filter(m=>m.position!=="resign").map(m=>
    ";"+(m.color===BLACK?"B":"W")+"["+coord(m.position)+"]").join("");
  const result=meta.result||snapshot.result;
  return "(;GM[1]FF[4]CA[UTF-8]SZ[9]KM["+esc(meta.komi??KOMI)+"]RU["+
    esc(meta.rules??"Chinese")+"]"+label("PB",meta.blackName)+
    label("PW",meta.whiteName)+label("RE",result)+moves+")";
}
