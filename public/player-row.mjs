// The turn row names both players: black, who moves first, on the left and
// white on the right, read left to right.
import { BLACK, WHITE } from "./core.mjs";
import { characterLabel } from "./ai-characters.mjs";
import { TEXT } from "./texts.mjs";

const comSide = com => ({name:characterLabel(com.character),detail:TEXT.ai.strengths[com.strength] ?? "",com:true});
const personSide = name => ({name,detail:"",com:false});

/** Each colour's name and the line under it, before the move-by-move state is added.
 * mode is "ai", "online" or "local"; watchAi holds the black and white COMs when watching. */
export function playerSides({mode, watching=false, humanColor=BLACK, aiCom, watchAi, onlineColor=null}) {
  if(mode==="ai" && watching)return {[BLACK]:comSide(watchAi.black),[WHITE]:comSide(watchAi.white)};
  if(mode==="ai"){
    const other=humanColor===BLACK?WHITE:BLACK;
    return {[humanColor]:personSide(TEXT.game.you),[other]:comSide(aiCom)};
  }
  if(mode==="online" && onlineColor){
    const other=onlineColor===BLACK?WHITE:BLACK;
    return {[onlineColor]:personSide(TEXT.game.you),[other]:personSide(TEXT.game.opponent)};
  }
  return {[BLACK]:personSide(TEXT.game.black),[WHITE]:personSide(TEXT.game.white)};
}
