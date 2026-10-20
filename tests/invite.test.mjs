import test from "node:test";
import assert from "node:assert/strict";
import { copyInviteText } from "../public/invite.mjs";
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
