import { BALANCE } from "./play-style.mjs";
import { TEXT } from "./texts.mjs";

// AIで絵にする on /style: the text for the player's own image-making AI. It
// carries the type and this result's numbers; how to draw is in ai.md.
const T = TEXT.playStyle;
const P = T.picture;

/** found: a read /style result; numbers: its 診断の根拠 lines as shown. */
export function picturePrompt(found, numbers, origin) {
  const type = T.types[found.type];
  return P.prompt({
    guide: origin + "/ai.md",
    code: found.type,
    name: type.name,
    catchLine: type.catch,
    text: found.games > 1 ? T.pooledText(type.text) : type.text,
    numbers,
    motif: P.motifs[found.type],
    colour: P.colours[found.type === BALANCE ? BALANCE : found.type.slice(2)],
  });
}
