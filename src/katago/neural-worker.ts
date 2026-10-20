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
import { whiteCompensation, rulesOf } from "../../public/core.mjs";

let model: KataGoModelV8Tf | null = null;
let boot: Promise<void> | null = null;
let backend = "uninitialized";
let newest: { id: number; state: unknown; kind?: "move" | "analyze" | "scoring" } | null = null;
let busy = false;

async function prepare() {
  if (boot) return boot;
  boot = (async () => {
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
/**
 * Encode a position for the network. The fully convolutional network accepts
 * any of MieGO's board sizes; the shared feature tables follow the position.
 */
function encode(state: unknown) {
  const { size, ...pos } = toKataGoPosition(state);
  setBoardSize(size);
  const spatialFeatures = new Float32Array(size * size * 22);
  const globalFeatures = new Float32Array(19);
  return { size, pos, spatialFeatures, globalFeatures };
}
async function evaluate(state: unknown) {
  if (!model) throw new Error("Model not initialized");
  const { size, pos, spatialFeatures, globalFeatures } = encode(state);
  const area = size * size;
  fillInputsV7FastForPosition({
    ...pos,
    // KataGo's NN komi input already includes the handicap bonus (selfKomi).
    komi: whiteCompensation(state),
    // Japanese games use KataGo's "japanese" ruleset: territory scoring, seki tax.
    rules: rulesOf(state),
    conservativePassAndIsRoot: true,
    outSpatial: spatialFeatures,
    outGlobal: globalFeatures
  });
  const spatial = tf.tensor4d(spatialFeatures, [1, size, size, 22]);
  const global = tf.tensor2d(globalFeatures, [1, 19]);
  let output: ReturnType<KataGoModelV8Tf["forward"]> | undefined;
  try {
    output = model.forward(spatial, global);
    const [owners, values, scores, rawPolicy] = await Promise.all([
      output.ownership.data(), output.value.data(), output.scoreValue.data(),
      output.policy.data()
    ]);
    const evaled = postprocessKataGoV8({
      nextPlayer: pos.currentPlayer, valueLogits: values, scoreValue: scores,
      postProcessParams: model.postProcessParams, modelVersion: model.modelVersion
    });
    // Ownership logits are relative to the player to move. Convert to Black-positive.
    const sign = pos.currentPlayer === "black" ? 1 : -1;
    const scale = model.postProcessParams.outputScaleMultiplier;
    const ownership = Array.from(owners, v => Math.tanh(v * scale) * sign);
    if (ownership.length !== area || ownership.some(v => !Number.isFinite(v))
      || !Number.isFinite(evaled.blackScoreLead) || !Number.isFinite(evaled.blackWinProb)) {
      throw new Error("Invalid KataGo neural network output");
    }
    // Policy for the player to move; the UI may show it as optional hints.
    const channels = model.policyOutChannels;
    const policy = rawPolicy.length === area * channels
      ? Array.from({ length: area }, (_, p) => rawPolicy[p * channels]) : null;
    let black = 0, white = whiteCompensation(state);
    for (const v of ownership) { black += (1 + v) / 2; white += (1 - v) / 2; }
    return {
      engine: "katago", backend, model: "katago-small (test network)",
      ownership, black, white, lead: evaled.blackScoreLead,
      winRate: evaled.blackWinProb,
      policy: policy && policy.every(Number.isFinite) ? policy : null
    };
  } finally {
    spatial.dispose();
    global.dispose();
    if (output) for (const t of Object.values(output)) t.dispose();
  }
}
async function evaluateMovePolicy(state: unknown) {
  if (!model) throw new Error("KataGo model not initialized");
  const { size, pos, spatialFeatures, globalFeatures } = encode(state);
  const area = size * size;
  fillInputsV7FastForPosition({
    ...pos, komi: whiteCompensation(state), rules: rulesOf(state),
    conservativePassAndIsRoot: true,
    outSpatial: spatialFeatures, outGlobal: globalFeatures
  });
  const spatial = tf.tensor4d(spatialFeatures, [1, size, size, 22]);
  const global = tf.tensor2d(globalFeatures, [1, 19]);
  let output: ReturnType<KataGoModelV8Tf["forward"]> | undefined;
  try {
    output = model.forward(spatial, global);
    const [raw, pass, rawOwnership] = await Promise.all([
      output.policy.data(), output.policyPass.data(), output.ownership.data()
    ]);
    const channels = model.policyOutChannels;
    if (raw.length !== area * channels || !pass.length)
      throw new Error("KataGo returned an unexpected policy shape");
    const policy = Array.from({ length:area }, (_, p) => raw[p * channels]);
    if (!policy.every(Number.isFinite) || !Number.isFinite(pass[0]))
      throw new Error("KataGo policy logits are not finite");
    // Same sign convention as MieGO: +1 Black controls, -1 White controls.
    const sign = pos.currentPlayer === "black" ? 1 : -1;
    const scale = model.postProcessParams.outputScaleMultiplier;
    const ownership = Array.from(rawOwnership, v => Math.tanh(v * scale) * sign);
    if (ownership.length !== area || !ownership.every(Number.isFinite))
      throw new Error("KataGo ownership output is invalid");
    return { kind:"move", engine:"katago", backend, policy, passLogit:pass[0], ownership };
  } finally {
    spatial.dispose(); global.dispose();
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
        const result = next.kind === "move" ? await evaluateMovePolicy(next.state) : await evaluate(next.state);
        if (!newest) self.postMessage({ id: next.id, kind: next.kind || "analyze", ...result });
      } catch (error) {
        if (!newest) self.postMessage({
          id: next.id, kind: next.kind || "analyze", error: error instanceof Error ? error.message : String(error), backend
        });
      }
    }
  } finally {
    busy = false;
  }
}
self.onmessage = event => {
  if (!event.data || !Number.isSafeInteger(event.data.id)) return;
  newest = { id: event.data.id, state: event.data.state,
    kind: event.data.kind === "move" ? "move" :
      event.data.kind === "scoring" ? "scoring" : "analyze" };
  void drain();
};


// Notify the UI separately from analysis/move requests. This ensures that
// AI matches cannot start until the actual network model has initialized.
void prepare().then(() => {
  self.postMessage({ kind: "availability", available: true, backend });
}).catch(error => {
  self.postMessage({ kind: "availability", available: false,
    error: error instanceof Error ? error.message : String(error) });
});
