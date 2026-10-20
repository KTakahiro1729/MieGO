import { BLACK, WHITE, sizeOf } from "./core.mjs";
import { resultWinner } from "./result-label.mjs";
import { TEXT } from "./texts.mjs";

// ドパガキモード: the 設定 sheet's オフ／オン／ULTRA choice, which only adds
// show on top of what happened: stones burst when taken (drawn by the board
// renderer), the board shakes on a big capture (ULTRA), and a win rains
// confetti over the board while its points count up. It never changes the
// game, never shows anything before a move is played, and has no random
// prizes or streaks: it cheers what the player did, nothing more.
// It starts off. Under prefers-reduced-motion nothing moves; the louder sounds
// still follow the 効果音 switch. Nothing flashes the whole board.
const DOPA_KEY = "miego-dopa";
const LEVELS = ["off", "on", "ultra"];
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
// ULTRA shakes the board when a move takes this many stones or more.
const SHAKE_FROM = 5;
const SHAKE_MS = 320;
const CONFETTI_MS = 1800;
const COUNT_UP_MS = 900;
const CONFETTI_COLOURS = ["#f0c773", "#e5675c", "#6cc4a1", "#6aa6e8", "#c08ee8", "#f4f1ea"];

/** A stored or chosen level, "off" unless it is one of the three. */
export const dopaLevel = value => LEVELS.includes(value) ? value : "off";

/** Points that make a win 圧勝 on this board: 10 on 9路, 20 on 13路, 30 on 19路. */
export const bigWinPoints = size => size >= 19 ? 30 : size >= 13 ? 20 : 10;

/**
 * What ドパガキモード cheers in the step from `before` to `after`:
 * {kind:"capture",count} when the move took stones, {kind:"win",winner,points,big}
 * when the game ended with a winner `viewer` cheers for (a colour, or null for
 * either side, as when watching or sharing one board), or null.
 */
export function dopaEvent(before, after, viewer = null) {
  if (before?.status !== "finished" && after?.status === "finished") {
    const winner = resultWinner(after.result);
    if (!winner) return null;
    const colour = winner === "B" ? BLACK : WHITE;
    if (viewer !== null && viewer !== colour) return null;
    const detail = /^[BW]\+(\d+(?:\.\d+)?)$/.exec(after.result);
    const points = detail ? Number(detail[1]) : null;
    return { kind: "win", winner, points, big: points !== null && points >= bigWinPoints(sizeOf(after.board)) };
  }
  const taken = state => (state?.captures?.black || 0) + (state?.captures?.white || 0);
  const count = taken(after) - taken(before);
  return count > 0 ? { kind: "capture", count } : null;
}

/** The label with its first number replaced by `value`, written to the same decimals. */
export function countedLabel(label, value) {
  return label.replace(/\d+(\.\d+)?/, number => value.toFixed(number.includes(".") ? number.split(".")[1].length : 0));
}

export function createDopaMode({ $, stage, frame, score, reducedMotion = () => false,
  random = Math.random, schedule = setTimeout, requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  now = () => performance.now() }) {
  let level = dopaLevel(stored(DOPA_KEY));
  const select = $("dopaMode");
  select.value = level;
  function setLevel(value) {
    level = dopaLevel(value);
    select.value = level;
    store(DOPA_KEY, level);
  }
  select.onchange = e => setLevel(e.target.value);
  $("resetAppearance").addEventListener?.("click", () => setLevel("off"));

  function shake() {
    frame.classList.remove("dopa-shake");
    // Read layout so the animation starts again on a second big capture.
    void frame.offsetWidth;
    frame.classList.add("dopa-shake");
    schedule(() => frame.classList.remove("dopa-shake"), SHAKE_MS);
  }
  function confetti(big) {
    const pieces = big ? 90 : 40;
    const made = [];
    for (let i = 0; i < pieces; i++) {
      const piece = stage.ownerDocument.createElement("span");
      piece.className = "dopa-confetti";
      piece.style.left = (random() * 100).toFixed(1) + "%";
      piece.style.background = CONFETTI_COLOURS[Math.floor(random() * CONFETTI_COLOURS.length)];
      piece.style.animationDelay = Math.round(random() * 500) + "ms";
      piece.style.setProperty("--drift", Math.round((random() - .5) * 80) + "px");
      piece.style.setProperty("--spin", Math.round((random() - .5) * 1080) + "deg");
      stage.append(piece);
      made.push(piece);
    }
    if (big) {
      const shout = stage.ownerDocument.createElement("strong");
      shout.className = "dopa-shout";
      shout.textContent = TEXT.dopa.bigWin;
      stage.append(shout);
      made.push(shout);
    }
    schedule(() => made.forEach(element => element.remove()), CONFETTI_MS);
  }
  // The result's points climb from 0; anything else rewriting the label stops it.
  function countUp(points) {
    const element = score();
    const label = element?.textContent;
    if (!requestFrame || !label || !/\d/.test(label)) return;
    const start = now();
    let shown = countedLabel(label, 0);
    element.textContent = shown;
    const step = () => {
      if (element.textContent !== shown) return;
      const p = Math.min(1, (now() - start) / COUNT_UP_MS);
      shown = p < 1 ? countedLabel(label, Math.floor(points * (1 - (1 - p) ** 3))) : label;
      element.textContent = shown;
      if (p < 1) requestFrame(step);
    };
    requestFrame(step);
  }

  /** Shows `event` (from dopaEvent) as the chosen level allows. */
  function celebrate(event) {
    if (level === "off" || !event || reducedMotion()) return;
    if (event.kind === "capture" && level === "ultra" && event.count >= SHAKE_FROM) shake();
    if (event.kind === "win") {
      confetti(level === "ultra" && event.big);
      if (event.points !== null) countUp(event.points);
    }
  }
  return { celebrate, level: () => level };
}
