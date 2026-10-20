import test from "node:test";
import assert from "node:assert/strict";
import { createAppearanceSettings } from "../public/appearance-settings.mjs";

// Just enough of the page for the sheet: every control is a plain object.
function fakePage() {
  const elements = new Map();
  const $ = id => {
    if (!elements.has(id)) elements.set(id, { id, value: "", textContent: "", hidden: false, disabled: false,
      style: {}, classList: { toggle() {} } });
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
