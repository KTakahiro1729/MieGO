import { guestUrl, ownUrl } from "./p2p-session.mjs";
import { TEXT } from "./texts.mjs";

/** Returns true only when the browser reports a successful copy.
 * Always leave the read-only URL selected for manual copying on failure.
 */
export async function copyInviteText(link, { clipboard, input, document: doc }) {
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

/** This player's own seat link, which moves the game to another device; null outside a room or without a key. */
export function seatLink({ origin, room, role, inviteKey }) {
  try { return room && inviteKey ? (role === "owner" ? ownUrl : guestUrl)(origin, room, inviteKey) : null; }
  catch { return null; }
}

/**
 * The 新規対戦 sheet's invitation button and side choice. `matches` is whether
 * the invitation already issued still fits the sheet's side, size and rules.
 */
export function inviteButtonView({ room, role, guestInviteKey, connected, moveNumber, issuedSide, matches }) {
  return {
    // Only the owner's device that created the room holds the guest's key.
    copyDisabled: !!room && (role !== "owner" || !guestInviteKey),
    // The side cannot change once the game has started.
    sideLocked: !!room && (connected || moveNumber > 0),
    label: !room ? TEXT.newGame.start :
      issuedSide !== null && !matches ? TEXT.online.renewInvite : TEXT.online.copyInvite,
  };
}
