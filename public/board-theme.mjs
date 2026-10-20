import { TEXT } from "./texts.mjs";
// Board looks. Each look fixes its own board, line and stone colours; the
// ownership colours that sit on top of it are tuned per look in territory-view.
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
export const isBoardTheme = value => typeof value === "string" && Object.hasOwn(BOARD_THEMES, value);
export const boardTheme = value => BOARD_THEMES[isBoardTheme(value) ? value : DEFAULT_BOARD_THEME];
export const surfaceCss = value => "rgb(" + boardTheme(value).surface.join(",") + ")";
