// The player's own name, chosen in 設定 and kept in this browser. It stands in
// for あなた in the turn row, goes to a friend in their game, and is written
// into saved games and SGF. An empty name keeps あなた.
const NAME_KEY = "miego-player-name";
export const NAME_LIMIT = 12;
const stored = () => { try { return localStorage.getItem(NAME_KEY); } catch { return null; } };
const store = value => { try { value ? localStorage.setItem(NAME_KEY, value) : localStorage.removeItem(NAME_KEY); } catch {} };

/** A name as it is shown and sent: one line, no control characters, at most NAME_LIMIT characters; "" when there is none. */
export function cleanName(value) {
  if (typeof value !== "string") return "";
  const line = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "").replace(/\s+/gu, " ").trim();
  return [...line].slice(0, NAME_LIMIT).join("").trim();
}

/** The 表示名 field: it shows the stored name and keeps each change; onChange hears the cleaned name. */
export function createPlayerName({ $, onChange = () => {} }) {
  let name = cleanName(stored());
  const input = $("playerName");
  input.value = name;
  input.maxLength = NAME_LIMIT;
  input.oninput = () => {
    const next = cleanName(input.value);
    if (next === name) return;
    name = next;
    store(name);
    onChange(name);
  };
  // What was typed is shown as it is kept once the field is left.
  input.onchange = () => { input.value = name; };
  return { name: () => name };
}
