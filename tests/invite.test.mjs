import test from "node:test";
import assert from "node:assert/strict";
import { copyInviteText, inviteButtonView, seatLink } from "../public/invite.mjs";
import { guestUrl, ownUrl } from "../public/p2p-session.mjs";
import { TEXT } from "../public/texts.mjs";
const stubInput = () => ({
  value: "", selected: false, focused: false,
  focus() { this.focused = true; },
  select() { this.selected = true; },
  setSelectionRange() {}
});

test("successful Clipboard API copy is reported as success", async () => {
  const input=stubInput(), calls=[];
  const ok=await copyInviteText("https://example/?room=1",{
    clipboard:{writeText:async v=>calls.push(v)},input,document:{execCommand:()=>{throw Error("should not be used");}}
  });
  assert.equal(ok,true);
  assert.equal(calls.length,1);
  assert.equal(input.value,"https://example/?room=1");
});
test("clipboard permission rejection keeps selectable URL and does not claim success", async () => {
  const input=stubInput();
  const ok=await copyInviteText("https://example/?room=2",{
    clipboard:{writeText:async()=>{throw new Error("NotAllowedError");}},
    input,document:{execCommand:()=>false}
  });
  assert.equal(ok,false);
  assert.equal(input.selected,true);
  assert.equal(input.focused,true);
  assert.equal(input.value,"https://example/?room=2");
});
test("legacy copy fallback works in browsers without clipboard API", async () => {
  const input=stubInput();
  const ok=await copyInviteText("https://example/?room=3",{
    clipboard:undefined,input,document:{execCommand:cmd=>cmd==="copy"}
  });
  assert.equal(ok,true);
  assert.equal(input.selected,true);
});

const room = "a".repeat(32), key = "b".repeat(48);
test("the seat link is this player's own, and missing outside a room or with a bad key", () => {
  assert.equal(seatLink({ origin: "https://x", room, role: "owner", inviteKey: key }), ownUrl("https://x", room, key));
  assert.equal(seatLink({ origin: "https://x", room, role: "guest", inviteKey: key }), guestUrl("https://x", room, key));
  assert.equal(seatLink({ origin: "https://x", room: null, role: "owner", inviteKey: key }), null);
  assert.equal(seatLink({ origin: "https://x", room, role: "owner", inviteKey: "bad" }), null);
});

test("the invitation button starts a room, copies it, or renews it when the sheet's choices changed", () => {
  const view = options => inviteButtonView({ room, role: "owner", guestInviteKey: key, connected: false,
    moveNumber: 0, issuedSide: "black", matches: true, ...options });
  assert.equal(view({ room: null }).label, TEXT.newGame.start);
  assert.equal(view().label, TEXT.online.copyInvite);
  assert.equal(view({ matches: false }).label, TEXT.online.renewInvite);
  assert.equal(view({ matches: false, issuedSide: null }).label, TEXT.online.copyInvite);
  // Only the owner's device that created the room holds the guest's key.
  assert.equal(view().copyDisabled, false);
  assert.equal(view({ role: "guest" }).copyDisabled, true);
  assert.equal(view({ guestInviteKey: null }).copyDisabled, true);
  // The side is fixed once the friend is there or a move is played.
  assert.deepEqual([view(), view({ connected: true }), view({ moveNumber: 1 }), view({ room: null, connected: true })]
    .map(v => v.sideLocked), [false, true, true, false]);
});
