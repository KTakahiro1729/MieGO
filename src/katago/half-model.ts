import { KataGoBinModelParser } from "../../vendor/web-katrain/src/engine/katago/binModelParser";
import { parseKataGoModelV8 } from "../../vendor/web-katrain/src/engine/katago/loadModelV8";

// A KataGo .bin network stores its weights as float32 after each "@BIN@".
// MieGO serves the small network with its large weight blocks as float16
// instead ("@F16@", a little-endian uint32 count, then the halves), which
// halves the download. Small blocks keep float32 as "@F32@" with a count, so
// every block says how long it is. The worker expands it back before parsing.
const BIN = [0x40, 0x42, 0x49, 0x4e, 0x40]; // @BIN@
const F16 = [0x40, 0x46, 0x31, 0x36, 0x40]; // @F16@
const F32 = [0x40, 0x46, 0x33, 0x32, 0x40]; // @F32@
/** Smaller blocks (batch norm, biases) stay float32: they are tiny and the most sensitive. */
export const HALF_MIN_COUNT = 4096;

const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
/** float32 → float16 bits, rounding to nearest even. */
export function halfBits(value: number): number {
  f32[0] = value;
  const x = u32[0], sign = (x >>> 16) & 0x8000, e32 = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (e32 === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);
  const exp = e32 - 112; // rebias 127 → 15
  if (exp >= 0x1f) return sign | 0x7c00;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - exp, rest = mant & ((1 << shift) - 1), half = 1 << (shift - 1);
    let h = mant >>> shift;
    if (rest > half || (rest === half && (h & 1))) h++;
    return sign | h;
  }
  let h = (exp << 10) | (mant >>> 13);
  const rest = mant & 0x1fff;
  if (rest > 0x1000 || (rest === 0x1000 && (h & 1))) h++; // a carry into the exponent is still correct
  return sign | h;
}
/** float16 bits → float32. */
export function fromHalfBits(h: number): number {
  const sign = h & 0x8000 ? -1 : 1, exp = (h >>> 10) & 0x1f, mant = h & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}
const startsWith = (data: Uint8Array, at: number, marker: number[]) => marker.every((b, i) => data[at + i] === b);
const isSpace = (b: number) => b === 0x20 || b === 0x0a || b === 0x0d || b === 0x09;

/** Rewrite a float32 network with float16 weight blocks. Build-time only. */
export function halveModel(raw: Uint8Array): Uint8Array {
  // Let the parser say where each weight block starts and how long it is.
  const blocks: { start: number; count: number }[] = [];
  const read = KataGoBinModelParser.prototype.readBinaryFloats;
  KataGoBinModelParser.prototype.readBinaryFloats = function (this: unknown, count: number) {
    let start = (this as { idx: number }).idx;
    while (isSpace(raw[start])) start++;
    blocks.push({ start, count });
    return read.call(this, count);
  };
  try { parseKataGoModelV8(raw); } finally { KataGoBinModelParser.prototype.readBinaryFloats = read; }
  const parts: Uint8Array[] = [];
  let from = 0;
  for (const { start, count } of blocks) {
    if (!startsWith(raw, start, BIN)) throw new Error("Unexpected KataGo weight block");
    parts.push(raw.subarray(from, start));
    const half = count >= HALF_MIN_COUNT;
    const out = new Uint8Array(9 + count * (half ? 2 : 4)), view = new DataView(out.buffer);
    out.set(half ? F16 : F32);
    view.setUint32(5, count, true);
    const floats = new DataView(raw.buffer, raw.byteOffset + start + 5, count * 4);
    if (half) for (let i = 0; i < count; i++) view.setUint16(9 + i * 2, halfBits(floats.getFloat32(i * 4, true)), true);
    else out.set(raw.subarray(start + 5, start + 5 + count * 4), 9);
    parts.push(out);
    from = start + 5 + count * 4;
  }
  parts.push(raw.subarray(from));
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { result.set(p, at); at += p.length; }
  return result;
}

/**
 * Expand "@F16@" and "@F32@" blocks back into the "@BIN@" form the parser reads.
 * Text between blocks never holds "@", and a block is skipped by its count,
 * so a scan from the start finds every block and nothing else.
 */
export function expandHalfModel(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const blockAt = (i: number) => {
    if (data[i] !== 0x40) return null;
    if (startsWith(data, i, F16)) return { width: 2, count: view.getUint32(i + 5, true) };
    if (startsWith(data, i, F32)) return { width: 4, count: view.getUint32(i + 5, true) };
    if (startsWith(data, i, BIN)) throw new Error("expandHalfModel reads only MieGO's float16 networks");
    return null;
  };
  let size = 0;
  for (let i = 0; i < data.length;) {
    const block = blockAt(i);
    if (block) { size += 5 + block.count * 4; i += 9 + block.count * block.width; } else { size++; i++; }
  }
  const out = new Uint8Array(size), outView = new DataView(out.buffer);
  let o = 0;
  for (let i = 0; i < data.length;) {
    const block = blockAt(i);
    if (!block) { out[o++] = data[i++]; continue; }
    out.set(BIN, o); o += 5;
    if (block.width === 4) { out.set(data.subarray(i + 9, i + 9 + block.count * 4), o); o += block.count * 4; }
    else for (let k = 0; k < block.count; k++, o += 4) outView.setFloat32(o, fromHalfBits(view.getUint16(i + 9 + k * 2, true)), true);
    i += 9 + block.count * block.width;
  }
  return out;
}
