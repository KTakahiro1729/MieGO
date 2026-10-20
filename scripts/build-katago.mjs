import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, copyFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { STRONG_NETWORKS } from "../public/strong-networks.mjs";

const MODEL_SHA = "7c87d9e1f4499b892974e78cac53dbf2ca84b84e";
const MODEL_URL = "https://raw.githubusercontent.com/Sir-Teo/web-katrain/8dd813aeb565cbdad5215dc75204fc40fd519c50/public/models/katago-small.bin.gz";
const modelPath = resolve("public/models/katago-small.bin.gz");
function gitBlobSha(bytes) {
  return createHash("sha1").update("blob " + bytes.byteLength + "\0").update(bytes).digest("hex");
}
async function ensureModel() {
  await mkdir(resolve("public/models"), { recursive: true });
  try {
    const data = await readFile(modelPath);
    if (gitBlobSha(data) === MODEL_SHA) {
      console.log("KataGo model: verified cached small network");
      return;
    }
  } catch {}
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(MODEL_URL, { redirect: "follow", signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error("Model HTTP " + response.status);
      const data = Buffer.from(await response.arrayBuffer());
      if (gitBlobSha(data) !== MODEL_SHA) throw new Error("Model SHA-1 differs from pinned Git blob");
      await writeFile(modelPath, data);
      console.log("KataGo model downloaded and verified:", data.length, "bytes");
      return;
    } catch (e) {
      error = e;
      console.warn("KataGo model download attempt", attempt + 1, e.message);
    }
  }
  throw new Error("Unable to download pinned KataGo test model: " + error?.message);
}
await ensureModel();

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
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw new Error("Model HTTP " + response.status);
      const data = Buffer.from(await response.arrayBuffer());
      if (sha256(data) !== pinned) throw new Error("Model SHA-256 differs from the pinned file");
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
      return;
    } catch (e) {
      error = e;
      console.warn("KataGo " + name + " download attempt", attempt + 1, e.message);
    }
  }
  throw new Error("Unable to download pinned KataGo " + name + ": " + error?.message);
}
for (const [key, network] of Object.entries(STRONG_NETWORKS)) await ensureStrongModel(key, network);
await mkdir(resolve("public/tfjs"), { recursive: true });
const wasmDir = resolve("node_modules/@tensorflow/tfjs-backend-wasm/dist");
let wasmFiles = 0;
for (const filename of await readdir(wasmDir)) {
  if (!filename.endsWith(".wasm")) continue;
  await copyFile(join(wasmDir, filename), resolve("public/tfjs", filename));
  wasmFiles++;
}
if (!wasmFiles) throw new Error("TensorFlow.js WASM files not found");
await build({
  entryPoints: ["src/katago/neural-worker.ts"],
  outfile: "public/katago-worker.bundle.mjs",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  logLevel: "info"
});
console.log("Browser KataGo worker built with WebGPU/WASM/CPU backends");
