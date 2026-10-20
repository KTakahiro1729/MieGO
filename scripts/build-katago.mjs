import { build } from "esbuild";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { STRONG_NETWORKS } from "../public/strong-networks.mjs";

const MODEL_SHA = "7c87d9e1f4499b892974e78cac53dbf2ca84b84e";
const MODEL_URL = "https://raw.githubusercontent.com/Sir-Teo/web-katrain/8dd813aeb565cbdad5215dc75204fc40fd519c50/public/models/katago-small.bin.gz";
// The pinned download is kept out of public/: the page gets the float16 copy.
const modelPath = resolve(".cache/katago-small.bin.gz");
const halfModelPath = resolve("public/models/katago-small.f16.bin.gz");
/** A pinned file, fetched up to three times until `check` (which throws on a mismatch) accepts it. */
async function downloadPinned(url, { timeout, label, failure, check }) {
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(timeout) });
      if (!response.ok) throw new Error("Model HTTP " + response.status);
      const data = Buffer.from(await response.arrayBuffer());
      check(data);
      return data;
    } catch (e) {
      error = e;
      console.warn(label + " download attempt", attempt + 1, e.message);
    }
  }
  throw new Error(failure + ": " + error?.message);
}
function gitBlobSha(bytes) {
  return createHash("sha1").update("blob " + bytes.byteLength + "\0").update(bytes).digest("hex");
}
async function ensureModel() {
  await mkdir(resolve(".cache"), { recursive: true });
  try {
    const data = await readFile(modelPath);
    if (gitBlobSha(data) === MODEL_SHA) {
      console.log("KataGo model: verified cached small network");
      return data;
    }
  } catch {}
  const data = await downloadPinned(MODEL_URL, {
    timeout: 45000, label: "KataGo model", failure: "Unable to download pinned KataGo test model",
    check: data => { if (gitBlobSha(data) !== MODEL_SHA) throw new Error("Model SHA-1 differs from pinned Git blob"); }
  });
  await writeFile(modelPath, data);
  console.log("KataGo model downloaded and verified:", data.length, "bytes");
  return data;
}
/** Publish the small network with float16 weights (src/katago/half-model.ts), about half the download. */
async function publishHalfModel(data) {
  const { outputFiles: [bundle] } = await build({
    entryPoints: ["src/katago/half-model.ts"], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent"
  });
  const { halveModel } = await import("data:text/javascript;base64," + Buffer.from(bundle.contents).toString("base64"));
  const half = gzipSync(halveModel(new Uint8Array(gunzipSync(data))), { level: 9 });
  await mkdir(resolve("public/models"), { recursive: true });
  await writeFile(halfModelPath, half);
  console.log("KataGo model published with float16 weights:", half.length, "bytes");
}
await publishHalfModel(await ensureModel());

// 最強's networks are about 100 MB each. Cloudflare serves files of at most
// 25 MiB, so each is published in parts; the page downloads them only when a
// game against 最強 starts.
const STRONG_PART_BYTES = 24 * 1024 * 1024;
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function ensureStrongModel(key, { name, url, sha256: pinned }) {
  const dir = resolve("public/models", key);
  await mkdir(dir, { recursive: true });
  try {
    const manifest = JSON.parse(await readFile(join(dir, "parts.json"), "utf8"));
    const parts = await Promise.all(manifest.parts.map(part => readFile(join(dir, part.path))));
    if (manifest.sha256 === pinned && sha256(Buffer.concat(parts)) === pinned) {
      console.log("KataGo " + name + ": verified cached parts");
      return;
    }
  } catch {}
  const data = await downloadPinned(url, {
    timeout: 300000, label: "KataGo " + name, failure: "Unable to download pinned KataGo " + name,
    check: data => { if (sha256(data) !== pinned) throw new Error("Model SHA-256 differs from the pinned file"); }
  });
  const parts = [];
  for (let start = 0; start < data.length; start += STRONG_PART_BYTES) {
    const path = "part-" + parts.length + ".bin";
    const chunk = data.subarray(start, start + STRONG_PART_BYTES);
    await writeFile(join(dir, path), chunk);
    parts.push({ path, bytes: chunk.length });
  }
  await writeFile(join(dir, "parts.json"),
    JSON.stringify({ name, sha256: pinned, bytes: data.length, parts }) + "\n");
  console.log("KataGo " + name + " downloaded and verified:", data.length, "bytes in", parts.length, "parts");
}
for (const [key, network] of Object.entries(STRONG_NETWORKS)) await ensureStrongModel(key, network);
// The worker and its WASM files go under /katago/<content hash>/, which
// public/_headers lets browsers keep without asking again. The page loads the
// small /katago-worker.bundle.mjs, which is asked about on every visit and
// imports the current hashed build.
const wasmDir = resolve("node_modules/@tensorflow/tfjs-backend-wasm/dist");
const wasm = [];
for (const filename of (await readdir(wasmDir)).sort()) {
  if (filename.endsWith(".wasm")) wasm.push({ filename, bytes: await readFile(join(wasmDir, filename)) });
}
if (!wasm.length) throw new Error("TensorFlow.js WASM files not found");
const { outputFiles: [bundle] } = await build({
  entryPoints: ["src/katago/neural-worker.ts"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  write: false,
  logLevel: "info"
});
const version = createHash("sha256").update(bundle.contents);
for (const { filename, bytes } of wasm) version.update(filename).update(bytes);
const hashed = "katago/" + version.digest("hex").slice(0, 16);
await rm(resolve("public/katago"), { recursive: true, force: true });
await mkdir(resolve("public", hashed), { recursive: true });
await writeFile(resolve("public", hashed, "worker.mjs"), bundle.contents);
for (const { filename, bytes } of wasm) await writeFile(resolve("public", hashed, filename), bytes);
await writeFile(resolve("public/katago-worker.bundle.mjs"),
  "// Generated by scripts/build-katago.mjs: the KataGo worker of this build.\n" +
  "import \"/" + hashed + "/worker.mjs\";\n");
console.log("Browser KataGo worker built with WebGPU/WASM/CPU backends at /" + hashed + "/");
