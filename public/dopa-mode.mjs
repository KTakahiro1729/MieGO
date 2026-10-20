import { BLACK, WHITE, sizeOf } from "./core.mjs";
import { resultWinner } from "./result-label.mjs";
import { TEXT } from "./texts.mjs";

// ドパガキモード: the 設定 sheet's オン／オフ switch, which only adds show on
// top of what happened. Every stone lands with a shockwave, taken stones burst
// into rainbow sparks under a big "+N" (both drawn by the board renderer) while
// the board shakes, harder the more were taken, and a win rains confetti over
// the board under 勝利！ or 圧勝！ while its points count up. A player's own
// move that the network itself would play (goodMove) rings its own chime and
// shakes the board, and the phone too where the browser can vibrate. Stepping through a
// replay onto a marked turning point of the 形勢グラフ bounces its mark under
// ドン！, and in 秒読み the running clock grows from 10 seconds left and the
// board's edge pulses red, once a second, from 5. It never changes the game,
// never shows anything before a move is played, and has no random prizes or
// streaks: it cheers what the player did, nothing more.
// It starts off. Under prefers-reduced-motion nothing moves (ドン！ and the
// bigger clock still show, standing still); the louder sounds still follow the
// 効果音 switch. Nothing flashes the whole board.
const DOPA_KEY = "miego-dopa";
const stillMotion = () => !!globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const stored = key => { try { return localStorage.getItem(key); } catch { return null; } };
const store = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
// A move taking this many stones or more quakes the board instead of shaking it.
const QUAKE_FROM = 4;
const SHAKE_MS = 420;
const CONFETTI_MS = 2400;
const COUNT_UP_MS = 1100;
const DON_MS = 900;
// The clock grows from this many ms left, and the board's edge pulses from PULSE_FROM.
const HURRY_FROM = 10000;
const PULSE_FROM = 5000;
// A move is good when the network gives it at least this share of its favourite's weight.
const GOOD_SHARE = .5;
const GOOD_BUZZ = [25, 40, 60];
const CONFETTI_COLOURS = ["#f0c773", "#e5675c", "#6cc4a1", "#6aa6e8", "#c08ee8", "#f4f1ea", "#ff8fd1"];

/** A stored level: "on" (the old オン and ULTRA included) or "off". */
export const dopaLevel = value => value === "on" || value === "ultra" ? "on" : "off";

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

/**
 * Whether playing `position` on `board` is a move KataGo's policy (logits for
 * the side to move, from the position before it) likes: its favourite among
 * the empty points, or one it weighs at least GOOD_SHARE as much. This is the
 * network's first impression, not a read, and a pass is never good.
 */
export function goodMove(policy, board, position) {
  if (!Array.isArray(policy) || policy.length !== board?.length || !Number.isInteger(position) || board[position]) return false;
  let best = -Infinity;
  board.forEach((stone, p) => { if (!stone && policy[p] > best) best = policy[p]; });
  return policy[position] >= best + Math.log(GOOD_SHARE);
}

/** The label with its first number replaced by `value`, written to the same decimals. */
export function countedLabel(label, value) {
  return label.replace(/\d+(\.\d+)?/, number => value.toFixed(number.includes(".") ? number.split(".")[1].length : 0));
}

export function createDopaMode({ $, stage, frame, graph, score, reducedMotion = stillMotion,
  vibrate = pattern => globalThis.navigator?.vibrate?.(pattern),
  random = Math.random, schedule = setTimeout, requestFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  now = () => performance.now() }) {
  let level = dopaLevel(stored(DOPA_KEY));
  const toggle = $("dopaMode");
  toggle.checked = level === "on";
  function setLevel(value) {
    level = dopaLevel(value);
    toggle.checked = level === "on";
    store(DOPA_KEY, level);
  }
  toggle.onchange = e => setLevel(e.target.checked ? "on" : "off");
  $("resetAppearance").addEventListener?.("click", () => setLevel("off"));

  function shake(name) {
    frame.classList.remove("dopa-shake", "dopa-quake");
    // Read layout so the animation starts again on the next capture.
    void frame.offsetWidth;
    frame.classList.add(name);
    schedule(() => frame.classList.remove(name), SHAKE_MS);
  }
  function confetti(big) {
    const pieces = big ? 180 : 120;
    const made = [];
    for (let i = 0; i < pieces; i++) {
      const piece = stage.ownerDocument.createElement("span");
      piece.className = "dopa-confetti";
      piece.style.left = (random() * 100).toFixed(1) + "%";
      piece.style.background = CONFETTI_COLOURS[Math.floor(random() * CONFETTI_COLOURS.length)];
      piece.style.animationDelay = Math.round(random() * 900) + "ms";
      piece.style.setProperty("--drift", Math.round((random() - .5) * 140) + "px");
      piece.style.setProperty("--spin", Math.round((random() - .5) * 1440) + "deg");
      stage.append(piece);
      made.push(piece);
    }
    const shout = stage.ownerDocument.createElement("strong");
    shout.className = "dopa-shout";
    shout.textContent = big ? TEXT.dopa.bigWin : TEXT.dopa.win;
    stage.append(shout);
    made.push(shout);
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

  /** Shows `event` (from dopaEvent) when the mode is on. */
  function celebrate(event) {
    if (level === "off" || !event || reducedMotion()) return;
    if (event.kind === "capture") shake(event.count >= QUAKE_FROM ? "dopa-quake" : "dopa-shake");
    if (event.kind === "win") {
      confetti(event.big);
      shake("dopa-quake");
      if (event.points !== null) countUp(event.points);
    }
  }
  /** A good move by the player: the board shakes, and so does the phone where it can. */
  function praise() {
    if (level === "off") return;
    try { vibrate(GOOD_BUZZ); } catch {}
    if (!reducedMotion()) shake("dopa-shake");
  }
  /** ドン！ for the replay landing on a marked turning point of the 形勢グラフ. */
  function don() {
    if (level === "off") return;
    const shout = stage.ownerDocument.createElement("strong");
    shout.className = "dopa-shout dopa-don";
    shout.textContent = TEXT.dopa.don;
    stage.append(shout);
    schedule(() => shout.remove(), DON_MS);
    if (reducedMotion()) return;
    shake("dopa-shake");
    graph.classList.remove("dopa-bounce");
    void graph.offsetWidth;
    graph.classList.add("dopa-bounce");
    schedule(() => graph.classList.remove("dopa-bounce"), DON_MS);
  }
  /**
   * Follows the shown running clock (a game-clock reading, or null when none
   * shows): pulses the board's edge near the end, and says whether the clock
   * itself should grow.
   */
  function countdown(reading) {
    const left = level === "off" || !reading ? Infinity : reading.left;
    frame.classList.toggle("dopa-pulse", left <= PULSE_FROM && !reducedMotion());
    return left <= HURRY_FROM;
  }
  return { celebrate, countdown, don, level: () => level, praise };
}
