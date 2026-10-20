import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, copyFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

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

// 最強 plays with KataGo's 9x9 network. Cloudflare serves files of at most
// 25 MiB, so the 98 MB file is published in parts; the page downloads them
// only when a game against 最強 starts.
const STRONG_SHA256 = "a1298ce1adc1dad7bd868ca962b2384cc8388ed373a00e6bae1114fa6f9e2d61";
const STRONG_URL = "https://github.com/lightvector/KataGo/releases/download/v1.13.2-kata9x9/kata9x9-b18c384nbt-20231025.bin.gz";
const STRONG_PART_BYTES = 24 * 1024 * 1024;
const strongDir = resolve("public/models/kata9x9");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
async function ensureStrongModel() {
  await mkdir(strongDir, { recursive: true });
  try {
    const manifest = JSON.parse(await readFile(join(strongDir, "parts.json"), "utf8"));
    const parts = await Promise.all(manifest.parts.map(part => readFile(join(strongDir, part.path))));
    if (manifest.sha256 === STRONG_SHA256 && sha256(Buffer.concat(parts)) === STRONG_SHA256) {
      console.log("KataGo 9x9 model: verified cached parts");
      return;
    }
  } catch {}
  let error;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(STRONG_URL, { redirect: "follow", signal: AbortSignal.timeout(300000) });
      if (!response.ok) throw new Error("Model HTTP " + response.status);
      const data = Buffer.from(await response.arrayBuffer());
      if (sha256(data) !== STRONG_SHA256) throw new Error("Model SHA-256 differs from the pinned release");
      const parts = [];
      for (let start = 0; start < data.length; start += STRONG_PART_BYTES) {
        const path = "part-" + parts.length + ".bin";
        const chunk = data.subarray(start, start + STRONG_PART_BYTES);
        await writeFile(join(strongDir, path), chunk);
        parts.push({ path, bytes: chunk.length });
      }
      await writeFile(join(strongDir, "parts.json"),
        JSON.stringify({ name: "kata9x9-b18c384nbt-20231025", sha256: STRONG_SHA256, bytes: data.length, parts }) + "\n");
      console.log("KataGo 9x9 model downloaded and verified:", data.length, "bytes in", parts.length, "parts");
      return;
    } catch (e) {
      error = e;
      console.warn("KataGo 9x9 model download attempt", attempt + 1, e.message);
    }
  }
  throw new Error("Unable to download pinned KataGo 9x9 model: " + error?.message);
}
await ensureStrongModel();
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
