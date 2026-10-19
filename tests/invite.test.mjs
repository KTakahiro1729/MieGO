import test from "node:test";
import assert from "node:assert/strict";
import { createRoomId, makeInviteUrl, copyInviteText } from "../public/invite.mjs";
const stubInput = () => ({
  value: "", selected: false, focused: false,
  focus() { this.focused = true; },
  select() { this.selected = true; },
  setSelectionRange() {}
});

test("room IDs are generated locally as 32 lowercase hex characters", () => {
  const id = createRoomId({getRandomValues(a) { for(let i=0;i<a.length;i++) a[i]=i; return a; }});
  assert.equal(id, "000102030405060708090a0b0c0d0e0f");
  assert.equal(createRoomId({getRandomValues(a) {a.fill(255);return a;}}).length,32);
});
test("invite URL is absolute and discards unrelated query parameters", () => {
  const room="abcdef1234567890abcdef1234567890";
  assert.equal(makeInviteUrl("https://miego.example",room), "https://miego.example/?room="+room);
  assert.throws(()=>makeInviteUrl("https://miego.example","../invalid"));
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
