import { readStyleLink } from "./play-style.mjs";
import { TEXT } from "./texts.mjs";

// The /style page: one 棋風診断 from a share sheet's link, or the 16 types.
const T = TEXT.playStyle;
const $ = id => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

// One row per axis: the first letter's name, a bar leaning towards it or the
// second's, and the second's name. Without leanings the type's own letter is lit.
function axisRow(axis, letter, lean) {
  const row = el("div", "style-bar-row");
  const high = el("span", "style-bar-end", axis.highName), low = el("span", "style-bar-end", axis.lowName);
  (letter === axis.high ? high : low).classList.add("is-lit");
  const bar = el("span", "style-bar");
  bar.setAttribute("aria-hidden", "true");
  if (lean != null) {
    const fill = el("span", "style-bar-fill");
    const size = Math.max(4, Math.abs(lean)) / 2;
    fill.style.width = size + "%";
    fill.style.left = lean >= 0 ? 50 - size + "%" : "50%";
    bar.append(fill);
  } else bar.classList.add(letter === axis.high ? "leans-high" : "leans-low");
  row.append(high, bar, low);
  return row;
}

function renderResult(found) {
  const box = $("styleResult");
  const type = found && T.types[found.type];
  if (!type) return;
  box.replaceChildren();
  if (found.color) {
    const side = el("p", "style-side");
    side.append(el("span", "style-stone " + (found.color === "B" ? "black" : "white")), T.sideLabel(found.color));
    box.append(side);
  }
  box.append(el("p", "style-code", found.type), el("h1", "style-name", type.name),
    el("p", "style-catch", type.catch), el("p", "style-text", found.games > 1 ? T.pooledText(type.text) : type.text));
  const bars = el("div", "style-bars");
  T.axes.forEach((axis, i) => bars.append(axisRow(axis, found.type[i], found.leans?.[i])));
  box.append(bars, el("p", "style-note", found.games > 1 ? T.pooled(found.games) : T.oneGame));
  box.hidden = false;
  $("styleIntro").hidden = true;
  document.title = T.pageTitle(found.type);
}

function renderAxes() {
  $("styleAxes").replaceChildren(...T.axes.map(axis => {
    const item = el("li");
    item.append(el("strong", null, axis.high + " " + axis.highName + " / " + axis.low + " " + axis.lowName),
      el("span", null, axis.about));
    return item;
  }));
}

function renderTypes(current) {
  $("styleTypes").replaceChildren(...Object.entries(T.types).map(([code, type]) => {
    const item = el("li"), link = el("a");
    link.href = "/style?t=" + code;
    if (code === current) link.setAttribute("aria-current", "page");
    link.append(el("span", "style-type-code", code), el("span", "style-type-name", type.name));
    item.append(link);
    return item;
  }));
}

const found = readStyleLink(location.search);
renderResult(found);
renderAxes();
renderTypes(found?.type);
