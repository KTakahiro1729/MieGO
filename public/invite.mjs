import { TEXT } from "./texts.mjs";
/** Browser-only room IDs do not need a network roundtrip. Durable Objects
 * materialize a room when its first participant opens a WebSocket.
 */
export function createRoomId(cryptoSource = globalThis.crypto) {
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== "function") {
    throw new Error(TEXT.online.needsSecureRandom);
  }
  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
export function makeInviteUrl(origin, room) {
  if (!/^[a-f0-9]{32}$/.test(room)) throw new Error(TEXT.online.badRoom);
  const url = new URL("/", origin);
  url.searchParams.set("room", room);
  return url.toString();
}
/** Returns true only when the browser reports a successful copy.
 * Always leave the read-only URL selected for manual copying on failure.
 */
export async function copyInviteText(link, { clipboard, input, document: doc }) {
  if (!input || !doc) throw new Error(TEXT.online.noInviteField);
  input.value = link;
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(link);
      return true;
    } catch { /* Explicit manual fallback, never report success on denial. */ }
  }
  input.focus();
  input.select();
  try { input.setSelectionRange(0, link.length); } catch {}
  try { return doc.execCommand?.("copy") === true; }
  catch { return false; }
}
