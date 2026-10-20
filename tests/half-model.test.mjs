import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";

const { outputFiles: [bundle] } = await build({
  entryPoints: ["src/katago/half-model.ts"], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent"
});
const { halfBits, fromHalfBits, halveModel, expandHalfModel } =
  await import("data:text/javascript;base64," + Buffer.from(bundle.contents).toString("base64"));

test("float16 rounding keeps exact halves and rounds to the nearest", () => {
  for (const v of [0, 1, -2, 0.5, 65504, 2 ** -24, -(2 ** -14)]) assert.equal(fromHalfBits(halfBits(v)), v);
  assert.equal(fromHalfBits(halfBits(1 + 2 ** -11)), 1); // a tie rounds to even
  assert.equal(fromHalfBits(halfBits(1 + 3 * 2 ** -12)), 1 + 2 ** -10);
  assert.equal(fromHalfBits(halfBits(1e6)), Infinity);
  assert.equal(fromHalfBits(halfBits(2 ** -26)), 0);
});

test("the served small network expands to the original layout with float16 weights", () => {
  const raw = new Uint8Array(gunzipSync(readFileSync(".cache/katago-small.bin.gz")));
  const half = halveModel(raw);
  assert.ok(half.length < raw.length * 0.55, "float16 should about halve the network");
  const back = expandHalfModel(half);
  assert.equal(back.length, raw.length);
  // Text and small blocks are byte-identical; each large block's weights are its float16 rounding.
  const original = new DataView(raw.buffer), expanded = new DataView(back.buffer);
  let differing = 0;
  for (let i = 0; i + 4 <= raw.length; i += 4) if (original.getUint32(i) !== expanded.getUint32(i)) differing++;
  assert.ok(differing > 0 && differing < raw.length / 4);
  assert.throws(() => expandHalfModel(raw), /float16/);
});
