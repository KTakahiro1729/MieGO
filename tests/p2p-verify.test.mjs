import test from "node:test";
import assert from "node:assert/strict";
import { verifyP2P } from "../public/p2p-verify.mjs";
import { TEXT } from "../public/texts.mjs";

// The sheet's elements, a config answer, and a Turnstile that answers with `outcome`.
function setup({ config = { siteKey: "site" }, sheetOpen = false, outcome = "token" } = {}) {
  const elements = { p2pVerify: { hidden: true }, onlineSetup: { hidden: !sheetOpen },
    p2pTurnstile: { replaceChildren() {} } };
  const calls = [];
  const win = { turnstile: { render(_el, options) {
    calls.push(["render", options.sitekey, options.action]);
    if (outcome === "token") options.callback("token");
    else options[outcome + "-callback"]();
  } } };
  const verify = () => verifyP2P({ $: id => elements[id],
    openSheet: () => calls.push(["open"]), closeSheet: () => calls.push(["close"]),
    fetch: async () => ({ json: async () => config }), win });
  return { elements, calls, verify };
}

test("the check opens the sheet for a guest and closes it again once it passes", async () => {
  const { elements, calls, verify } = setup();
  assert.equal(await verify(), "token");
  assert.equal(elements.p2pVerify.hidden, false);
  assert.deepEqual(calls, [["open"], ["render", "site", "miego_p2p"], ["close"]]);
});

test("a sheet the player had open stays open after the check", async () => {
  const { calls, verify } = setup({ sheetOpen: true });
  assert.equal(await verify(), "token");
  assert.deepEqual(calls, [["render", "site", "miego_p2p"]]);
});

test("the check says why it cannot run or did not pass", async () => {
  await assert.rejects(setup({ config: { rooms: false } }).verify(), { message: TEXT.online.roomsUnavailable });
  await assert.rejects(setup({ config: {} }).verify(), { message: TEXT.online.turnstileMissing });
  await assert.rejects(setup({ outcome: "error" }).verify(), { message: TEXT.online.verifyFailed });
  await assert.rejects(setup({ outcome: "expired" }).verify(), { message: TEXT.online.verifyExpired });
});
