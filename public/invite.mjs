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
