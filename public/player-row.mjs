// The turn row names both players: black, who moves first, on the left and
// white on the right, read left to right.
import { BLACK, WHITE } from "./core.mjs";
import { characterLabel } from "./ai-characters.mjs";
import { TEXT } from "./texts.mjs";

const comSide = com => ({name:characterLabel(com.character),detail:TEXT.ai.strengths[com.strength] ?? "",com:true});
const personSide = name => ({name,detail:"",com:false});

/** Each colour's name and the line under it, before the move-by-move state is added.
 * mode is "ai", "online" or "local"; watchAi holds the black and white COMs when watching.
 * myName is the player's 表示名 and peerName the friend's, each "" until there is one. */
export function playerSides({mode, watching=false, humanColor=BLACK, aiCom, watchAi, onlineColor=null, myName="", peerName=""}) {
  const me=myName || TEXT.game.you;
  if(mode==="ai" && watching)return {[BLACK]:comSide(watchAi.black),[WHITE]:comSide(watchAi.white)};
  if(mode==="ai"){
    const other=humanColor===BLACK?WHITE:BLACK;
    return {[humanColor]:personSide(me),[other]:comSide(aiCom)};
  }
  if(mode==="online" && onlineColor){
    const other=onlineColor===BLACK?WHITE:BLACK;
    return {[onlineColor]:personSide(me),[other]:personSide(peerName || TEXT.game.opponent)};
  }
  return {[BLACK]:personSide(TEXT.game.black),[WHITE]:personSide(TEXT.game.white)};
}

/** The names a saved game keeps for each colour: people's 表示名 and the COMs' characters; null where none is known. */
export function recordNames({mode, watching=false, humanColor=BLACK, aiCom, watchAi, onlineColor=null, myName="", peerName=""}) {
  if(mode==="ai" && watching)return {black:characterLabel(watchAi.black.character),white:characterLabel(watchAi.white.character)};
  let mine=null,theirs=null,color=null;
  if(mode==="ai"){color=humanColor;mine=myName||null;theirs=characterLabel(aiCom.character);}
  else if(mode==="online" && onlineColor){color=onlineColor;mine=myName||null;theirs=peerName||null;}
  else return {black:null,white:null};
  return color===BLACK?{black:mine,white:theirs}:{black:theirs,white:mine};
}
