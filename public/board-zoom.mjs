/**
 * Pinch zoom for the main board. The canvas is only transformed for display;
 * taps still map through getBoundingClientRect, so game input is unchanged.
 * A view is {scale,x,y}: x/y are translations as fractions of the board size.
 */
export const IDENTITY_VIEW = Object.freeze({scale:1,x:0,y:0});
export const HINT_MIN_SIZE = 13;
const HINT_KEY = "miego:pinch-hint:v1";

export function maxScaleFor(size) {
  return Math.min(4, Math.max(2, size/6));
}

/** Keep the zoomed board covering its frame; scales near 1 snap back to the full view. */
export function clampView(view, maxScale) {
  const scale = Math.min(maxScale, Math.max(1, Number(view.scale) || 1));
  if(scale < 1.04)return IDENTITY_VIEW;
  const clamp = v => Math.min(0, Math.max(1-scale, Number(v) || 0));
  return {scale, x:clamp(view.x), y:clamp(view.y)};
}

/** Keep the board point under the starting midpoint under the current midpoint. */
export function pinchView(start, from, to, frameSize, maxScale) {
  const mid = ([a,b]) => [(a.x+b.x)/2/frameSize, (a.y+b.y)/2/frameSize];
  const dist = ([a,b]) => Math.hypot(a.x-b.x, a.y-b.y);
  const [m0x,m0y] = mid(from), [m1x,m1y] = mid(to);
  const scale = Math.min(maxScale, Math.max(1, start.scale * dist(to) / Math.max(1, dist(from))));
  const cx = (m0x-start.x)/start.scale, cy = (m0y-start.y)/start.scale;
  return clampView({scale, x:m1x-cx*scale, y:m1y-cy*scale}, maxScale);
}

export function panView(start, dx, dy, frameSize, maxScale) {
  return clampView({scale:start.scale, x:start.x+dx/frameSize, y:start.y+dy/frameSize}, maxScale);
}

/** Zoom by a factor around a point given as a fraction of the frame. */
export function zoomAround(view, factor, fx, fy, maxScale) {
  const scale = Math.min(maxScale, Math.max(1, view.scale*factor));
  const cx = (fx-view.x)/view.scale, cy = (fy-view.y)/view.scale;
  return clampView({scale, x:fx-cx*scale, y:fy-cy*scale}, maxScale);
}

/**
 * Detects repeated taps around one area of an unzoomed large board, the
 * sign that a player is struggling to hit an intersection. Coordinates are
 * in intersections, so the radius is independent of the screen size.
 */
export function createRepeatTapDetector({count=3, windowMs=8000, radius=1.5}={}) {
  let taps = [];
  return {
    note(x, y, time) {
      taps = taps.filter(t => time-t.time <= windowMs && Math.hypot(t.x-x, t.y-y) <= radius);
      taps.push({x, y, time});
      if(taps.length < count)return false;
      taps = [];
      return true;
    },
    reset() { taps = []; }
  };
}

/** Wires gestures, the ambient backdrop and the one-time hint to the board DOM. */
export function createBoardZoom({frame, canvas, bleed, resetButton, hint, getSize,
  baseResolution=canvas.width, redraw=()=>{}, storage=globalThis.localStorage, now=()=>Date.now()}) {
  let view = IDENTITY_VIEW, gesture = null, suppressClick = false, hintTimer = null;
  const pointers = new Map();
  const detector = createRepeatTapDetector();
  const bleedContext = bleed?.getContext("2d");
  const BLEED_DOWNSCALE = 2; // a low-resolution copy is cheap and already soft
  let hintSeen = false;
  try { hintSeen = storage?.getItem(HINT_KEY) === "1"; } catch {}

  const maxScale = () => maxScaleFor(getSize());
  const frameSize = () => canvas.parentElement.getBoundingClientRect().width || 1;
  const local = e => {
    const rect = canvas.parentElement.getBoundingClientRect();
    return {x:e.clientX-rect.left, y:e.clientY-rect.top};
  };

  function render() {
    const zoomed = view.scale > 1;
    canvas.style.transform = zoomed ?
      `translate(${view.x*100}%,${view.y*100}%) scale(${view.scale})` : "";
    frame.classList.toggle("is-zoomed", zoomed);
    frame.ownerDocument.body.classList.toggle("board-zoomed", zoomed);
    if(resetButton)resetButton.hidden = !zoomed;
    paintBleed();
  }
  // Re-render the canvas at a higher backing resolution once a gesture settles.
  function sharpen() {
    const resolution = Math.round(baseResolution*Math.min(3, view.scale));
    if(canvas.width === resolution)return;
    canvas.width = canvas.height = resolution;
    redraw();
  }
  function setView(next, {animate=true}={}) {
    view = clampView(next, maxScale());
    frame.classList.toggle("is-gesturing", !animate);
    render();
    if(animate)sharpen();
  }
  // Copy the transformed board to the full-screen layer at its on-screen position.
  function paintBleed() {
    if(!bleedContext || view.scale <= 1)return;
    const win = frame.ownerDocument.defaultView;
    const width = Math.ceil(win.innerWidth/BLEED_DOWNSCALE), height = Math.ceil(win.innerHeight/BLEED_DOWNSCALE);
    if(bleed.width !== width || bleed.height !== height) { bleed.width = width; bleed.height = height; }
    const rect = canvas.getBoundingClientRect();
    bleedContext.clearRect(0, 0, width, height);
    bleedContext.drawImage(canvas, rect.left/BLEED_DOWNSCALE, rect.top/BLEED_DOWNSCALE,
      rect.width/BLEED_DOWNSCALE, rect.height/BLEED_DOWNSCALE);
  }

  function showHint() {
    if(hintSeen || !hint)return;
    hintSeen = true;
    try { storage?.setItem(HINT_KEY, "1"); } catch {}
    hint.hidden = false;
    hint.classList.remove("is-playing");
    void hint.offsetWidth; // restart the CSS animation
    hint.classList.add("is-playing");
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { hint.hidden = true; hint.classList.remove("is-playing"); }, 3200);
  }

  canvas.addEventListener("pointerdown", e => {
    pointers.set(e.pointerId, local(e));
    try { canvas.setPointerCapture(e.pointerId); } catch {}
    if(pointers.size === 2) {
      gesture = {type:"pinch", start:view, from:[...pointers.values()]};
      suppressClick = true;
    } else if(pointers.size === 1) {
      gesture = {type:"pan", start:view, from:local(e), moved:false};
      suppressClick = false;
    }
  });
  canvas.addEventListener("pointermove", e => {
    if(!pointers.has(e.pointerId))return;
    pointers.set(e.pointerId, local(e));
    if(gesture?.type === "pinch" && pointers.size >= 2) {
      setView(pinchView(gesture.start, gesture.from, [...pointers.values()].slice(0,2),
        frameSize(), maxScale()), {animate:false});
    } else if(gesture?.type === "pan" && view.scale > 1) {
      const p = local(e), dx = p.x-gesture.from.x, dy = p.y-gesture.from.y;
      if(!gesture.moved && Math.hypot(dx, dy) < 10)return;
      gesture.moved = true;
      suppressClick = true;
      setView(panView(gesture.start, dx, dy, frameSize(), maxScale()), {animate:false});
    }
  });
  function release(e) {
    if(!pointers.delete(e.pointerId))return;
    if(pointers.size === 1) {
      // Lifting one finger of a pinch continues as a pan with the other.
      const [rest] = pointers.values();
      gesture = {type:"pan", start:view, from:rest, moved:true};
    } else if(pointers.size === 0) {
      gesture = null;
      setView(view);
    }
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  // Trackpad pinches arrive as ctrl+wheel; plain wheels keep scrolling the page.
  canvas.addEventListener("wheel", e => {
    if(!e.ctrlKey)return;
    e.preventDefault();
    const p = local(e), size = frameSize();
    setView(zoomAround(view, Math.exp(-e.deltaY/200), p.x/size, p.y/size, maxScale()), {animate:false});
    clearTimeout(gesture?.wheelTimer);
    gesture = {type:"wheel", wheelTimer:setTimeout(() => { gesture = null; setView(view); }, 160)};
  }, {passive:false});
  resetButton?.addEventListener("click", () => reset());
  canvas.addEventListener("transitionend", paintBleed);
  frame.ownerDocument.defaultView.addEventListener("resize", paintBleed);

  function reset() {
    if(view.scale === 1)return;
    setView(IDENTITY_VIEW);
  }
  return {
    reset,
    paintBleed,
    get view() { return view; },
    /** Returns true when the click finished a pan/pinch and must not place a stone. */
    consumeGestureClick() {
      const consumed = suppressClick;
      suppressClick = false;
      return consumed;
    },
    noteTap(x, y) {
      if(view.scale > 1 || getSize() < HINT_MIN_SIZE || hintSeen)return;
      if(detector.note(x, y, now()))showHint();
    }
  };
}
