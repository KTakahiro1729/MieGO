import test from "node:test";
import assert from "node:assert/strict";
import { createAppearanceSettings } from "../public/appearance-settings.mjs";

// Just enough of the page for the sheet: every control is a plain object.
function fakePage() {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { id, value: "", textContent: "", hidden: false, disabled: false,
      style: { setProperty(name, value) { this[name] = value; } }, classList: { toggle() {} } });
    return elements.get(id);
  };
  globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
  return { $, canvas: { closest: () => null }, getGame: () => ({ status: "playing" }),
    hidingStones: () => false, isCounting: () => false, show() {}, draw() {}, onOverlayOn() {} };
}

test("the 設定 sheet starts on the defaults and keeps working where storage is blocked", () => {
  const blocked = () => { throw new Error("SecurityError"); };
  globalThis.localStorage = { getItem: blocked, setItem: blocked };
  const page = fakePage();
  const settings = createAppearanceSettings(page);
  assert.equal(settings.palette(), "mono");
  assert.equal(settings.opacity(), .55);
  page.$("opacity").oninput({ target: { value: "30" } });
  assert.equal(settings.opacity(), .3);
  page.$("resetAppearance").onclick();
  assert.equal(settings.opacity(), .55);
  assert.equal(page.$("opacity").value, "55");
});

test("saved choices are read back and the reset saves the defaults", () => {
  const saved = new Map([["miego-opacity", "0"], ["miego-palette", "none"]]);
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const page = fakePage();
  const settings = createAppearanceSettings(page);
  assert.equal(settings.opacity(), 0);
  assert.equal(settings.palette(), "none");
  page.$("resetAppearance").onclick();
  assert.equal(saved.get("miego-opacity"), "0.55");
  assert.equal(saved.get("miego-palette"), "mono");
});

test("カスタム's swatches change its colours without opening a picker", () => {
  const saved = new Map([["miego-board", "custom"]]);
  globalThis.localStorage = { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  const node = () => ({ style: {}, dataset: {}, attrs: {}, children: [], classList: { toggle() {} },
    setAttribute(name, value) { this.attrs[name] = value; }, append(...c) { this.children.push(...c); } });
  const page = fakePage();
  globalThis.document.createElement = node;
  for (const key of ["board", "line", "black", "white"]) Object.assign(page.$("boardColour-" + key), node());
  const settings = createAppearanceSettings(page);
  settings.syncControls();
  assert.equal(settings.boardTheme(), "custom");
  assert.equal(page.$("customBoardColours").hidden, false, "the swatches show while カスタム is chosen");
  const row = page.$("boardColour-board").children;
  const chip = row.find(c => c.dataset.colour === "#f3e1e6");
  chip.onclick();
  assert.equal(JSON.parse(saved.get("miego-board-colours")).board, "#f3e1e6");
  assert.equal(chip.attrs["aria-checked"], "true");
  assert.equal(page.$("customBoardSwatch").style["--sw-board"], "#f3e1e6");
  // Only the last button holds the device's colour picker.
  assert.equal(row.filter(c => c.children.some(i => i.type === "color")).length, 1);
  assert.equal(row.at(-1).children[0].type, "color");
});
