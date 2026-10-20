import { TEXT } from "./texts.mjs";

// Every copy of text meant for an AI chat (or a plain link) uses the async
// Clipboard API; when the browser refuses, the text is left selected instead.
const MANUAL_COPY=TEXT.common.manualCopy;
export async function writeClipboard(text) {
  if(typeof navigator.clipboard?.writeText!=="function")throw Error("Clipboard API unavailable");
  await navigator.clipboard.writeText(text);
}
export async function copyWithFallback(text,status,field,copied=TEXT.common.copied) {
  try{
    await writeClipboard(text);
    field.hidden=true;status.textContent=copied;
  }catch{
    field.value=text;field.hidden=false;field.focus();field.select();
    try{field.setSelectionRange(0,text.length);}catch{}
    status.textContent=MANUAL_COPY;
  }
}
