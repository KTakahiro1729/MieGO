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
