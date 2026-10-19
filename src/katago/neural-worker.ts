/// <reference lib="webworker" />
import * as tf from "@tensorflow/tfjs";
import "@tensorflow/tfjs-backend-webgpu";
import "@tensorflow/tfjs-backend-wasm";
import { setWasmPaths, setThreadsCount } from "@tensorflow/tfjs-backend-wasm";
import { ungzip } from "pako";
import { setBoardSize } from "../../vendor/web-katrain/src/engine/katago/fastBoard";
import { fillInputsV7FastForPosition } from "../../vendor/web-katrain/src/engine/katago/positionInputsV7";
import { parseKataGoModelV8 } from "../../vendor/web-katrain/src/engine/katago/loadModelV8";
import { KataGoModelV8Tf } from "../../vendor/web-katrain/src/engine/katago/modelV8";
import { postprocessKataGoV8 } from "../../vendor/web-katrain/src/engine/katago/evalV8";
import { toKataGoPosition } from "./position.mjs";

let model: KataGoModelV8Tf | null = null;
let boot: Promise<void> | null = null;
let backend = "uninitialized";
let newest: { id: number; state: unknown } | null = null;
let busy = false;

async function prepare() {
  if (boot) return boot;
  boot = (async () => {
    setBoardSize(9);
    setWasmPaths("/tfjs/");
    setThreadsCount(1); // Works without COOP/COEP and avoids heavy memory use on phones.
    let chosen = false;
    for (const name of ["webgpu", "wasm", "cpu"]) {
      try {
        if (name === "webgpu" && !(navigator as Navigator & { gpu?: unknown }).gpu) continue;
        if (!await tf.setBackend(name)) continue;
        await tf.ready();
        backend = name;
        chosen = true;
        break;
      } catch (e) {
        console.warn("KataGo backend", name, e);
      }
    }
    if (!chosen) throw new Error("No compatible TensorFlow.js backend");
    const response = await fetch("/models/katago-small.bin.gz", { cache: "force-cache" });
    if (!response.ok) throw new Error("KataGo model HTTP " + response.status);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const parsed = parseKataGoModelV8(ungzip(bytes));
    if (parsed.metaEncoderVersion !== 0) throw new Error("A human-SL metadata model is not supported");
    model = new KataGoModelV8Tf(parsed);
  })();
  return boot;
}
async function evaluate(state: unknown) {
  if (!model) throw new Error("Model not initialized");
  const pos = toKataGoPosition(state);
  const spatialFeatures = new Float32Array(9 * 9 * 22);
  const globalFeatures = new Float32Array(19);
  fillInputsV7FastForPosition({
    ...pos,
    komi: 7.5,
    rules: "chinese",
    conservativePassAndIsRoot: true,
    outSpatial: spatialFeatures,
    outGlobal: globalFeatures
  });
  const spatial = tf.tensor4d(spatialFeatures, [1, 9, 9, 22]);
  const global = tf.tensor2d(globalFeatures, [1, 19]);
  let output: ReturnType<KataGoModelV8Tf["forward"]> | undefined;
  try {
    output = model.forward(spatial, global);
    const [owners, values, scores] = await Promise.all([
      output.ownership.data(), output.value.data(), output.scoreValue.data()
    ]);
    const evaled = postprocessKataGoV8({
      nextPlayer: pos.currentPlayer, valueLogits: values, scoreValue: scores,
      postProcessParams: model.postProcessParams, modelVersion: model.modelVersion
    });
    // Ownership logits are relative to the player to move. Convert to Black-positive.
    const sign = pos.currentPlayer === "black" ? 1 : -1;
    const scale = model.postProcessParams.outputScaleMultiplier;
    const ownership = Array.from(owners, v => Math.tanh(v * scale) * sign);
    if (ownership.length !== 81 || ownership.some(v => !Number.isFinite(v))
      || !Number.isFinite(evaled.blackScoreLead) || !Number.isFinite(evaled.blackWinProb)) {
      throw new Error("Invalid KataGo neural network output");
    }
    let black = 0, white = 7.5;
    for (const v of ownership) { black += (1 + v) / 2; white += (1 - v) / 2; }
    return {
      engine: "katago", backend, model: "katago-small (test network)",
      ownership, black, white, lead: evaled.blackScoreLead,
      winRate: evaled.blackWinProb
    };
  } finally {
    spatial.dispose();
    global.dispose();
    if (output) for (const t of Object.values(output)) t.dispose();
  }
}
async function drain() {
  if (busy) return;
  busy = true;
  try {
    while (newest) {
      const next = newest;
      newest = null;
      try {
        await prepare();
        if (newest) continue; // superseded while the model was initializing
        const result = await evaluate(next.state);
        if (!newest) self.postMessage({ id: next.id, ...result });
      } catch (error) {
        if (!newest) self.postMessage({
          id: next.id, error: error instanceof Error ? error.message : String(error), backend
        });
      }
    }
  } finally {
    busy = false;
  }
}
self.onmessage = event => {
  if (!event.data || !Number.isSafeInteger(event.data.id)) return;
  newest = { id: event.data.id, state: event.data.state };
  void drain();
};
