import { makeReviewUrl } from "./sgf-link.mjs";
import { makeRulesPrompt, makePositionPrompt } from "./beginner-prompts.mjs";
import { copyWithFallback } from "./clipboard.mjs";
import { TEXT } from "./texts.mjs";

// The help sheet, the local ? popovers and the beginner questions in it.
// closePanels() closes every sheet; the help sheet uses it when it opened the
// backdrop itself, and the backdrop and Escape close whichever is on top.
export function createHelpSheet({$,getGame,setBackgroundInert,closePanels}) {
  // The full help sheet opens from the header and stacks above any open sheet.
  let helpOwnsBackdrop=false;
  function openHelp() {
    closeHelpPopover(false);
    helpOwnsBackdrop=$("settingsBackdrop").hidden;
    if(helpOwnsBackdrop){setBackgroundInert(true);$("settingsBackdrop").hidden=false;}
    $("helpPanel").hidden=false;
    $("helpToggle").setAttribute("aria-expanded","true");
    for(const item of $("helpPanel").querySelectorAll("details"))item.open=false;
    $("beginnerPromptStatus").textContent="";$("beginnerPromptFallback").hidden=true;
    $("helpPanel").scrollTop=0;
    $("closeHelp").focus();
  }
  function closeHelp() {
    $("helpPanel").hidden=true;
    $("helpToggle").setAttribute("aria-expanded","false");
    if(helpOwnsBackdrop)closePanels();
    else $("helpToggle").focus();
  }
  // A local ? shows only its own topic, beside the button. The text is copied
  // from the help sheet so each explanation is written once.
  let helpPopoverOpener=null;
  function openHelpPopover(topic,opener) {
    const source=$("help-"+topic);
    if(!source)return;
    const pop=$("helpPopover"),body=$("helpPopoverBody");
    $("helpPopoverTitle").textContent=source.querySelector("summary").textContent;
    body.replaceChildren(...[...source.children].filter(node=>node.tagName!=="SUMMARY").map(node=>{
      const copy=node.cloneNode(true);
      for(const el of [copy,...copy.querySelectorAll("[id]")])el.removeAttribute("id");
      return copy;
    }));
    helpPopoverOpener=opener;
    pop.hidden=false;
    const margin=12,gap=8,r=opener.getBoundingClientRect();
    const width=pop.offsetWidth,height=pop.offsetHeight;
    const below=r.bottom+gap,above=r.top-gap-height;
    pop.style.top=(below+height<=innerHeight-margin||above<margin?
      Math.max(margin,Math.min(below,innerHeight-margin-height)):above)+"px";
    pop.style.left=Math.max(margin,Math.min(r.left+r.width/2-width/2,innerWidth-margin-width))+"px";
    $("closeHelpPopover").focus();
  }
  function closeHelpPopover(restoreFocus=true) {
    if($("helpPopover").hidden)return;
    $("helpPopover").hidden=true;
    if(restoreFocus)helpPopoverOpener?.focus();
    helpPopoverOpener=null;
  }
  // Beginner questions describe the live game, never the board being replayed.
  async function copyBeginnerPrompt(make) {
    const status=$("beginnerPromptStatus"),area=$("beginnerPromptFallback");
    let link=null,question;
    try{link=makeReviewUrl(location.origin,{snapshot:getGame()},getGame().moves.length);}catch{}
    try{question=make(getGame(),link);}
    catch{status.textContent=TEXT.prompts.failed;return;}
    await copyWithFallback(question,status,area,TEXT.prompts.copiedForAi);
  }
  $("copyRulesPrompt").onclick=()=>void copyBeginnerPrompt(makeRulesPrompt);
  $("copyPositionPrompt").onclick=()=>void copyBeginnerPrompt(makePositionPrompt);
  $("helpToggle").onclick=()=>$("helpPanel").hidden?openHelp():closeHelp();
  $("closeHelp").onclick=closeHelp;
  $("closeHelpPopover").onclick=()=>closeHelpPopover();
  // Every local ? names its topic in data-help, so one listener serves them all.
  document.addEventListener("click",e=>{
    const button=e.target.closest?.("[data-help]");
    if(!button)return;
    if(helpPopoverOpener===button)closeHelpPopover();
    else openHelpPopover(button.dataset.help,button);
  });
  // A tap anywhere else, or a layout change, dismisses the popover.
  document.addEventListener("pointerdown",e=>{
    if(!e.target.closest?.("#helpPopover,[data-help]"))closeHelpPopover(false);
  });
  addEventListener("resize",()=>closeHelpPopover(false));
  $("settingsBackdrop").onclick=()=>$("helpPanel").hidden?closePanels():closeHelp();
  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape")return;
    if(!$("helpPopover").hidden){closeHelpPopover();return;}
    if($("settingsBackdrop").hidden)return;
    if(!$("helpPanel").hidden)closeHelp();else closePanels();
  });
  return {closeHelpPopover};
}
