// The human check (Cloudflare Turnstile) a friend's game asks for before a room
// is created or joined. Its script is loaded only when first needed.
import { TEXT } from "./texts.mjs";
import { UserError } from "./user-error.mjs";

const TURNSTILE_SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * Shows the check in the 新規対戦 sheet's 対友人 tab and resolves with its token.
 * `openSheet`/`closeSheet` open that tab; a guest's sheet opens only for the
 * check, so it closes again once the check passes.
 */
export async function verifyP2P({$, openSheet, closeSheet,
  fetch = globalThis.fetch, win = globalThis.window, doc = globalThis.document}) {
  $("p2pVerify").hidden=false;
  const opened=$("onlineSetup").hidden;
  if(opened)openSheet();
  const config=await fetch("/api/p2p/config").then(r=>r.json());
  if(config.rooms===false)throw new UserError(TEXT.online.roomsUnavailable);
  if(!config.siteKey)throw new UserError(TEXT.online.turnstileMissing);
  if(!win.turnstile){
    await new Promise((resolve,reject)=>{
      const script=doc.createElement("script");
      script.src=TURNSTILE_SCRIPT;
      script.onload=resolve;script.onerror=()=>reject(new UserError(TEXT.online.verifyLoadFailed));
      doc.head.append(script);
    });
  }
  return new Promise((resolve,reject)=>{
    $("p2pTurnstile").replaceChildren();
    win.turnstile.render($("p2pTurnstile"),{sitekey:config.siteKey,action:"miego_p2p",
      callback:token=>{if(opened)closeSheet();resolve(token);},"error-callback":()=>reject(new UserError(TEXT.online.verifyFailed)),
      "expired-callback":()=>reject(new UserError(TEXT.online.verifyExpired))});
  });
}
