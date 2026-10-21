import {
  BALANCE,
  compatibility,
  FAR_REASON,
  LET_GO_REASON,
  pairShare,
  readResignReason,
  readStyleLink,
  readStyleMovesHash,
  typeShare,
} from "./play-style.mjs";
import { boardThumbnailSvg } from "./board-thumbnail.mjs";
import { copyWithFallback } from "./clipboard.mjs";
import { parseSGF, replaySteps } from "./sgf.mjs";
import { makeStyleMovesPrompt } from "./sgf-link.mjs";
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
    // 自由/律儀's reason from FAR_REASON is a distance. 引き際's reason below 0 is a
    // resignation's timing, from LET_GO_REASON where stones were let go.
    const given = found.evidence?.[i];
    const shown = given == null ? given : i === 2 ? (given >= FAR_REASON ? { apart: (given - FAR_REASON) / 10 } : given) :
      i !== 3 ? given : given < 0 ? readResignReason(given) : given >= LET_GO_REASON ? { letGo: given - LET_GO_REASON } : given;
    const say = T.evidence[i];
    const line = shown == null || !say ? null : typeof say === "function" ? say(shown) : say[shown];
    if (line) item.append(el("span", null, line));
    list.append(item);
  });
  box.append(list);
  return box;
}

// あなたらしかった手, from the link's fragment: a board for each, the most like
// the player first, opening the replay at it, with a question for an AI chat on why.
function movesSection(found, moves) {
  const M = T.moves;
  let snapshot;
  try { snapshot = parseSGF(moves.sgf).snapshot; } catch { return null; }
  const picks = moves.picks.filter(pick => pick.step <= snapshot.moves.length &&
    Number.isInteger(snapshot.moves[pick.step - 1].position)).map((pick, rank) => {
    const url = new URL("/", location.origin);
    url.searchParams.set("sgf", moves.sgf);
    url.searchParams.set("move", String(pick.step));
    return { ...pick, rank, url: url.href };
  });
  if (!picks.length) return null;
  const box = el("section", "style-moves");
  box.append(el("h2", null, M.title(moves.com)));
  const grid = el("div", "style-moves-grid");
  // One line under both boards says the question was copied, or holds it to copy by hand.
  const status = el("p", "style-note");
  status.setAttribute("role", "status");
  const field = el("textarea", "style-move-fallback");
  field.readOnly = true;
  field.hidden = true;
  field.setAttribute("aria-label", TEXT.share.manualCopy);
  for (const pick of picks) {
    const card = el("div", "style-move");
    const board = el("a", "style-move-board");
    board.href = pick.url;
    board.target = "_blank";
    board.rel = "noopener";
    board.setAttribute("aria-label", M.view(pick.step));
    board.innerHTML = boardThumbnailSvg(replaySteps(snapshot, pick.step).board, snapshot.moves[pick.step - 1].position);
    const ask = el("button", "secondary full", M.ask);
    ask.type = "button";
    ask.setAttribute("aria-label", M.askAria(pick.step));
    ask.onclick = () => void copyWithFallback(makeStyleMovesPrompt({ type: found.type, color: found.color, com: moves.com }, [pick]),
      status, field, M.copied);
    card.append(el("p", "style-move-rank", M.ranks[pick.rank]), board,
      el("p", "style-move-step", M.move(pick.step)),
      el("p", "style-move-reasons", pick.reasons.map(r => M.reasons[r.axis](r)).join(M.join)), ask);
    grid.append(card);
  }
  box.append(grid, status, field, el("p", "style-note", M.criterion));
  return box;
}

// One player's 棋風診断 into box; the partner's card leaves the moves, title and intro to the first.
function renderResult(found, box = $("styleResult"), first = true) {
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
  const moves = first && readStyleMovesHash(location.hash);
  const shown = moves && movesSection(found, moves);
  if (shown) box.append(shown);
  box.append(el("p", "style-note", found.games > 1 ? T.pooled(found.games) : T.oneGame));
  if (found.ranks || typeShare(found.type) != null) box.append(el("p", "style-note", T.peopleSource));
  box.hidden = false;
  if (!first) return;
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
      // The link to send carries the type alone, not the game in its fragment.
      const link = location.href.split("#")[0];
      try { await navigator.clipboard.writeText(link); status.textContent = C.copied; } catch { status.textContent = link; }
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
// A link for two players shows the partner's 棋風診断 under the first one's.
if (found?.partner) renderResult(found.partner, $("stylePartnerResult"), false);
renderCompat(found);
renderAxes();
renderTypes(found?.type);
