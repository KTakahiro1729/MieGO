import { TEXT } from "./texts.mjs";

// Irreversible actions (投了, leaving a friend's match) are confirmed in place:
// the first tap arms the button itself (danger color and a trailing ？ on its
// label), optionally explaining below it; only a second tap on it proceeds.
// A second tap sooner than RETAP_MIN_MS is a double-tap or a bounce, not a
// decision, so it leaves the button armed.
export const RETAP_MIN_MS=500;
export function createRetapConfirm({now=()=>performance.now()}={}) {
  let armedConfirm=null;
  function confirmByRetap(button,message=null,armedAria=null) {
    if(armedConfirm?.button===button){
      if(now()-armedConfirm.armedAt<RETAP_MIN_MS)return false;
      disarmConfirm();return true;
    }
    disarmConfirm();
    armedConfirm={button,note:null,label:button.textContent,aria:button.getAttribute("aria-label"),armedAt:now()};
    if(message){
      const note=document.createElement("p");
      note.id="armedConfirmNote";note.className="armed-note";note.setAttribute("role","status");
      note.textContent=TEXT.confirm.retap(message);
      button.setAttribute("aria-describedby",note.id);
      button.after(note);
      armedConfirm.note=note;
    }
    if(armedAria)button.setAttribute("aria-label",armedAria);
    button.classList.add("danger-armed");
    button.textContent=TEXT.confirm.armedLabel(armedConfirm.label);
    return false;
  }
  // Renderers rewrite these labels; keep the armed ？ on whatever they wrote.
  function keepArmedLabel(button) {
    if(armedConfirm?.button!==button)return;
    armedConfirm.label=button.textContent;
    button.textContent=TEXT.confirm.armedLabel(armedConfirm.label);
  }
  function disarmConfirm() {
    if(!armedConfirm)return;
    armedConfirm.button.classList.remove("danger-armed");
    armedConfirm.button.removeAttribute("aria-describedby");
    armedConfirm.button.textContent=armedConfirm.label;
    if(armedConfirm.aria!==null)armedConfirm.button.setAttribute("aria-label",armedConfirm.aria);
    armedConfirm.note?.remove();
    armedConfirm=null;
  }
  document.addEventListener("pointerdown",e=>{
    if(armedConfirm && !armedConfirm.button.contains(e.target))disarmConfirm();
  });
  // A held Enter repeats clicks after any interval; only a fresh press confirms.
  document.addEventListener("keydown",e=>{
    if(e.repeat && armedConfirm?.button.contains(e.target))e.preventDefault();
  });
  return {confirmByRetap,keepArmedLabel,disarmConfirm};
}
