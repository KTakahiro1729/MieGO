import {
  BALANCE,
  compatibility,
  LET_GO_REASON,
  pairShare,
  readResignReason,
  readStyleLink,
  typeShare,
} from "./play-style.mjs";
import { copyWithFallback } from "./clipboard.mjs";
import { picturePrompt } from "./style-picture.mjs";
import { TEXT } from "./texts.mjs";

// The /style page: one 棋風診断 from a share sheet's link, or the 17 types.
const T = TEXT.playStyle;
const P = T.picture;
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

// 引き際's reason below 0 is a resignation's timing, from LET_GO_REASON where stones were let go.
function evidenceLine(found, i) {
  const given = found.evidence?.[i];
  const shown = i !== 3 || given == null ? given : given < 0 ? readResignReason(given) :
    given >= LET_GO_REASON ? { letGo: given - LET_GO_REASON } : given;
  const say = T.evidence[i];
  return shown == null || !say ? null : typeof say === "function" ? say(shown) : say[shown];
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
    const line = evidenceLine(found, i);
    if (line) item.append(el("span", null, line));
    list.append(item);
  });
  box.append(list);
  return box;
}

// AIで絵にする: the text to paste into the player's own image-making AI, shown before it is copied.
function pictureSection(found) {
  const box = el("section", "style-picture");
  const text = picturePrompt(found, T.axes.map((axis, i) => evidenceLine(found, i)).filter(Boolean), location.origin);
  const copy = el("button", "secondary full", P.copy);
  copy.type = "button";
  const status = el("p", "style-note");
  status.setAttribute("role", "status");
  const field = el("textarea", "help-copy-fallback");
  Object.assign(field, { readOnly: true, hidden: true, rows: 8, spellcheck: false });
  copy.onclick = () => void copyWithFallback(text, status, field, TEXT.prompts.copiedForAi);
  const shown = el("details", "style-picture-text");
  shown.append(el("summary", null, P.show), el("pre", null, text));
  box.append(el("h2", null, P.title), el("p", "style-note", P.note), copy, status, field, shown);
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
  box.append(pictureSection(found));
  box.append(el("p", "style-note", found.games > 1 ? T.pooled(found.games) : T.oneGame));
  if (found.ranks || typeShare(found.type) != null) box.append(el("p", "style-note", T.peopleSource));
  box.hidden = false;
  $("styleIntro").hidden = true;
  document.title = T.pageTitle(found.type);
}

const C = T.compat;
// Two types read together: the partner's from the link, or one picked here.
function compatCard(found, partner) {
  const result = compatibility(found, partner);
  const card = el("div", "style-compat-card");
  const pair = el("p", "style-compat-pair");
  pair.append(el("span", "style-code", found.type), el("span", "style-compat-x", "×"), el("span", "style-code", partner.type));
  const headline = result.headline.startsWith("differ") ? C.headlines.differ[Number(result.headline.slice(6))] : C.headlines[result.headline];
  card.append(pair, el("p", "style-compat-names", T.types[found.type].name + " × " + T.types[partner.type].name),
    el("p", "style-compat-percent", C.percent(result.percent)), el("h2", "style-compat-headline", headline));
  const share = pairShare(found.type, partner.type);
  if (share != null) card.append(el("p", "style-rarity", C.pairShare(share)));
  const lines = el("ul", "style-compat-lines");
  // With the balanced type, each line names the side the other player leans to.
  const other = found.type === BALANCE ? partner : found;
  if (other.type === BALANCE) lines.append(el("li", null, C.bothBalance));
  else result.relations.forEach((relation, i) => lines.append(el("li", null,
    relation === "balance" ? C.balance[i](letterName(other, i)) : C[relation][i])));
  card.append(lines);
  return card;
}

function renderCompat(found) {
  const box = $("styleCompat");
  if (!found || !T.types[found.type]) return;
  box.replaceChildren(el("p", "style-kicker", C.title));
  const holder = el("div");
  if (found.partner) holder.append(compatCard(found, found.partner));
  else {
    // Pick a partner here, or send this page to them.
    const label = el("label", "style-compat-pick");
    const select = el("select");
    select.append(Object.assign(el("option", null, C.partnerNone), { value: "" }));
    for (const [code, type] of Object.entries(T.types)) select.append(Object.assign(el("option", null, code + " " + type.name), { value: code }));
    label.append(el("span", null, C.partnerLabel), select);
    const card = el("div");
    select.onchange = () => card.replaceChildren(...(select.value ? [compatCard(found, { type: select.value })] : []));
    const status = el("p", "style-note");
    const copy = el("button", "secondary full", C.copyLink);
    copy.type = "button";
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); status.textContent = C.copied; } catch { status.textContent = location.href; }
    };
    const mine = el("a", "style-cta secondary", C.matchMine);
    mine.href = "/?open=history-style&with=" + found.type + (found.leans ? "," + found.leans.join(",") : "");
    holder.append(el("p", "style-note", C.partnerPick), label, card, copy, status, mine);
  }
  box.append(holder);
  box.hidden = false;
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
renderCompat(found);
renderAxes();
renderTypes(found?.type);
