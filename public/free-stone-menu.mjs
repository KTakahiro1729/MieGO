import { BLACK, WHITE, isFree } from "./core.mjs";
import { TEXT } from "./texts.mjs";

// 自由に置く: a tap on the board opens a small menu just above that point. An
// empty point takes ● 黒 or ○ 白; a stone is taken off or turned into the
// other colour. One tap and one choice, and 待った undoes it.
export function createFreeStoneMenu({$,getGame,onChoose}) {
  const menu=$("freeStoneMenu"),first=$("freeStoneFirst"),second=$("freeStoneSecond");
  // The point and what stood on it when the menu opened.
  let open=null;
  const choices=stone=>stone?
    [{label:TEXT.game.freeRemove,color:stone,replace:false},
      {label:stone===BLACK?TEXT.game.freeToWhite:TEXT.game.freeToBlack,color:-stone,replace:true}]:
    [{label:TEXT.common.sideBlack,color:BLACK,replace:false},
      {label:TEXT.common.sideWhite,color:WHITE,replace:false}];
  /** `point` is the tapped point in client coordinates, `pitch` the distance
   * between lines and `top` the board's top edge, which the menu stays below. */
  function openAt(position,point,pitch,top=0) {
    const stone=getGame().board[position];
    open={position,stone,choices:choices(stone)};
    first.textContent=open.choices[0].label;
    second.textContent=open.choices[1].label;
    menu.hidden=false;
    // Above the point, clear of the finger; below it when the top is too close.
    const margin=8,gap=Math.max(8,pitch*.6),width=menu.offsetWidth,height=menu.offsetHeight;
    const above=point.y-gap-height,below=point.y+gap;
    const y=above>=Math.max(margin,top)?above:Math.min(below,innerHeight-margin-height);
    const left=Math.max(margin,Math.min(point.x-width/2,innerWidth-margin-width));
    menu.style.top=y+"px";menu.style.left=left+"px";
    menu.classList.toggle("is-below",y>point.y);
    menu.style.setProperty("--pointer-x",Math.max(14,Math.min(width-14,point.x-left))+"px");
  }
  function close() {
    if(!open)return;
    open=null;menu.hidden=true;
  }
  /** The board changed under the menu (a friend's edit, 待った, a new game): it no longer applies. */
  function sync() {
    const game=getGame();
    if(open && (!isFree(game) || game.status!=="playing" || game.board[open.position]!==open.stone))close();
  }
  const choose=index=>{
    if(!open)return;
    const {position,choices:[...list]}=open;
    sync();
    if(!open)return;
    close();
    onChoose({position,...list[index]});
  };
  first.onclick=()=>choose(0);
  second.onclick=()=>choose(1);
  // A tap anywhere else closes it; a tap on the board opens it at the new point.
  document.addEventListener("pointerdown",e=>{
    if(open && !menu.contains(e.target))close();
  },true);
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape" && open){e.stopPropagation();close();}
  },true);
  addEventListener("resize",close);
  addEventListener("scroll",close,true);
  return {close,isOpen:()=>!!open,openAt,sync};
}
