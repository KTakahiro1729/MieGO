import { BALANCE, readResignReason, readStyleLink, typeShare } from "./play-style.mjs";
import { TEXT } from "./texts.mjs";

// The /style page: one 棋風診断 from a share sheet's link, or the 17 types.
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
  if (letter) (letter === axis.high ? high : low).classList.add("is-lit");
  const bar = el("span", "style-bar");
  bar.setAttribute("aria-hidden", "true");
  if (lean != null) {
    const fill = el("span", "style-bar-fill");
    const size = Math.max(4, Math.abs(lean)) / 2;
    fill.style.width = size + "%";
    fill.style.left = lean >= 0 ? 50 - size + "%" : "50%";
    bar.append(fill);
  } else if (letter) bar.classList.add(letter === axis.high ? "leans-high" : "leans-low");
  row.append(high, bar, low);
  return row;
}

// The name of the side the player leans to on axis i: its letter's, or by leaning for the balanced type.
function letterName(found, i) {
  const axis = T.axes[i];
  const high = found.type === BALANCE ? (found.leans?.[i] ?? 0) >= 0 : found.type[i] === axis.high;
  return high ? axis.highName : axis.lowName;
}

function evidenceList(found) {
  const box = el("section", "style-evidence");
  box.append(el("h2", null, T.evidenceTitle));
  const list = el("ul");
  T.axes.forEach((axis, i) => {
    const item = el("li");
    // The balanced type leans nowhere, so it is told each axis's numbers without a side or rank.
    const balanced = found.type === BALANCE;
    item.append(el("strong", null, balanced ? axis.highName + "・" + axis.lowName :
      letterName(found, i) + (found.ranks?.[i] != null ? " " + T.rank(found.ranks[i]) : "")));
    // 引き際's reason below 0 is a resignation's timing.
    const shown = i === 3 && found.evidence?.[i] < 0 ? readResignReason(found.evidence[i]) : found.evidence?.[i];
    const say = T.evidence[i];
    const line = shown == null || !say ? null : typeof say === "function" ? say(shown) : say[shown];
    if (line) item.append(el("span", null, line));
    list.append(item);
  });
  box.append(list);
  return box;
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
    el("p", "style-catch", type.catch));
  // What makes it special comes first: the axis where the player stands out most, and how rare the type is.
  if (found.type === BALANCE) box.append(el("p", "style-rank", T.balanceRank));
  else if (found.ranks) {
    const best = found.ranks.indexOf(Math.min(...found.ranks.filter(rank => rank != null)));
    box.append(el("p", "style-rank", T.topRank(letterName(found, best), found.ranks[best])));
  }
  if (typeShare(found.type) != null) box.append(el("p", "style-rarity", T.rarity(typeShare(found.type))));
  box.append(el("p", "style-text", found.games > 1 ? T.pooledText(type.text) : type.text));
  const bars = el("div", "style-bars");
  T.axes.forEach((axis, i) => bars.append(axisRow(axis, found.type === BALANCE ? null : found.type[i], found.leans?.[i])));
  box.append(bars);
  if (found.ranks || found.evidence) box.append(evidenceList(found));
  box.append(el("p", "style-note", found.games > 1 ? T.pooled(found.games) : T.oneGame));
  if (found.ranks || typeShare(found.type) != null) box.append(el("p", "style-note", T.peopleSource));
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
