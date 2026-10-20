import { TEXT } from "./texts.mjs";
// Board looks. Each look fixes its own board, line and stone colours; the
// ownership colours that sit on top of it are the same on every look.
// `surface` is the average board colour the overlay is blended against.
export const BOARD_THEMES = Object.freeze({
  wood: Object.freeze({
    label:TEXT.settings.themes.wood,
    surface:[229,197,140],
    fill:["#e5c58c"],
    line:"#685537", star:"#725b39",
    stones:Object.freeze({
      black:Object.freeze({inner:"#555b5a",outer:"#101718",rim:"#1a2626"}),
      white:Object.freeze({inner:"#ffffff",outer:"#b8b8b1",rim:"#a1a29c"})
    }),
    flatStones:false
  }),
  // A flat, light grey board with flat stones and no grain.
  light: Object.freeze({
    label:TEXT.settings.themes.light,
    surface:[189,193,199],
    fill:["#bdc1c7"],
    line:"#7b818b", star:"#6b717b",
    stones:Object.freeze({
      black:Object.freeze({inner:"#1b1f24",outer:"#1b1f24",rim:"#0d1013"}),
      white:Object.freeze({inner:"#f7f7f4",outer:"#f7f7f4",rim:"#8d9096"})
    }),
    flatStones:true
  }),
  // A dark board with a faint sheen; black stones carry a light rim
  // so they stay visible against it.
  dark: Object.freeze({
    label:TEXT.settings.themes.dark,
    surface:[38,50,63],
    fill:["#334457","#26323f","#1c2631"],
    line:"rgba(200,225,245,.4)", star:"rgba(200,225,245,.62)",
    stones:Object.freeze({
      black:Object.freeze({inner:"#5d6a78",outer:"#07090c",rim:"rgba(190,215,235,.6)"}),
      white:Object.freeze({inner:"#ffffff",outer:"#c9d3dc",rim:"#e6eef5"})
    }),
    flatStones:false
  })
});
export const DEFAULT_BOARD_THEME = "wood";
// The player's own board: four colours picked in the settings, kept here so
// the board, the thumbnails and the shared image all read the same ones.
// Stones keep the wood board's shading, built from the picked colour.
export const BOARD_CUSTOM = "custom";
export const BOARD_COLOUR_KEYS = Object.freeze(["board","line","black","white"]);
const rgbOf = value => /^#[0-9a-f]{6}$/i.test(value) ? [1,3,5].map(i=>parseInt(value.slice(i,i+2),16)) : null;
const hex = rgb => "#"+rgb.map(c=>Math.round(Math.min(255,Math.max(0,c))).toString(16).padStart(2,"0")).join("");
// Mix toward white (t>0) or black (t<0).
const shade = (rgb,t) => hex(rgb.map(c=>t>0 ? c+(255-c)*t : c*(1+t)));
function customLook({board,line,black,white}) {
  const [b,l,k,w]=[board,line,black,white].map(rgbOf);
  return Object.freeze({
    label:TEXT.settings.themes.custom,
    surface:Object.freeze(b),
    fill:Object.freeze([hex(b)]),
    line:hex(l), star:hex(l),
    stones:Object.freeze({
      black:Object.freeze({inner:shade(k,.3),outer:hex(k),rim:shade(k,-.3)}),
      white:Object.freeze({inner:shade(w,.6),outer:shade(w,-.2),rim:shade(w,-.32)})
    }),
    flatStones:false
  });
}
// The swatches offered for each colour of the custom board; any other colour
// can still be picked with the colour input next to them.
export const BOARD_COLOUR_CHOICES = Object.freeze({
  board:Object.freeze(["#e5c58c","#f0d9a8","#f1ede3","#f3e1e6","#6f9d7c","#26323f"]),
  line:Object.freeze(["#685537","#7b818b","#8a5a6a","#2f4a37","#111111","#d0b25c"]),
  black:Object.freeze(["#101718","#1d2050","#4a0f0f","#1f3a2a","#3a2a4a","#4a4f57"]),
  white:Object.freeze(["#e8e8e2","#f0dfb8","#f6d6dc","#d6ecf6","#e2f0d6","#c9c9c0"])
});
// Until the player picks, the custom board starts from the wood board.
let customColours = Object.freeze({board:"#e5c58c",line:"#685537",black:"#101718",white:"#e8e8e2"});
let customTheme = customLook(customColours);
/** The four colours a look shows, as the settings' pickers take them. */
export const boardColours = value => {
  if(value===BOARD_CUSTOM)return {...customColours};
  const look=boardTheme(value);
  return {board:look.fill[Math.floor(look.fill.length/2)],line:toHex(look.line,look.surface),
    black:look.stones.black.outer,white:look.stones.white.inner};
};
// A line given as rgba() is shown in the picker as it looks on the board.
function toHex(colour,surface) {
  if(rgbOf(colour))return colour.toLowerCase();
  const m=/rgba?\(([\d.]+),([\d.]+),([\d.]+)(?:,([\d.]+))?\)/.exec(colour.replace(/\s/g,""));
  if(!m)return "#000000";
  const a=m[4]===undefined?1:Number(m[4]);
  return hex([1,2,3].map((k,i)=>Number(m[k])*a+surface[i]*(1-a)));
}
/** Sets the custom board from {board,line,black,white} hex colours; returns false if any is invalid. */
export function setCustomBoardColours(value) {
  if(BOARD_COLOUR_KEYS.some(key=>!rgbOf(value?.[key])))return false;
  customColours=Object.freeze(Object.fromEntries(BOARD_COLOUR_KEYS.map(key=>[key,value[key].toLowerCase()])));
  customTheme=customLook(customColours);
  return true;
}
export const isBoardTheme = value => value === BOARD_CUSTOM || typeof value === "string" && Object.hasOwn(BOARD_THEMES, value);
export const boardTheme = value => value === BOARD_CUSTOM ? customTheme : BOARD_THEMES[isBoardTheme(value) ? value : DEFAULT_BOARD_THEME];
export const surfaceCss = value => "rgb(" + boardTheme(value).surface.join(",") + ")";
