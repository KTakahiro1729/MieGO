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
import { whiteCompensation, rulesOf, play, BLACK } from "../../public/core.mjs";
import { STRONG_NETWORKS } from "../../public/strong-networks.mjs";

let model: KataGoModelV8Tf | null = null;
let boot: Promise<void> | null = null;
let backend = "uninitialized";
let newest: { id: number; state: unknown; kind?: "move" | "analyze" | "scoring" | "settle"; read?: { one: number; two: number } } | null = null;
let busy = false;

// The page starts a second worker with ?net=<key> for 最強; it only plays moves.
const strongNet = new URLSearchParams(self.location.search).get("net");
const strong = strongNet !== null && Object.hasOwn(STRONG_NETWORKS, strongNet);
const modelName = strong ? STRONG_NETWORKS[strongNet as keyof typeof STRONG_NETWORKS].name : "katago-small (test network)";
async function fetchBytes(url: string) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error("KataGo model HTTP " + response.status);
  return new Uint8Array(await response.arrayBuffer());
}
/** 最強's network comes in parts (Cloudflare serves at most 25 MiB a file),
 * reported as they arrive so the page can show how far the download is. */
async function downloadStrongModel() {
  const base = "/models/" + strongNet + "/";
  const listing = await fetch(base + "parts.json", { cache: "no-cache" });
  if (!listing.ok) throw new Error("KataGo model HTTP " + listing.status);
  const manifest = await listing.json() as
    { bytes: number; parts: { path: string; bytes: number }[] };
  const whole = new Uint8Array(manifest.bytes);
  let loaded = 0;
  self.postMessage({ kind: "progress", loaded, total: manifest.bytes });
  for (const part of manifest.parts) {
    const bytes = await fetchBytes(base + part.path);
    if (bytes.length !== part.bytes) throw new Error("KataGo model part has the wrong size");
    whole.set(bytes, loaded);
    loaded += bytes.length;
    self.postMessage({ kind: "progress", loaded, total: manifest.bytes });
  }
  return whole;
}
async function prepare() {
  if (boot) return boot;
  boot = (async () => {
    // The model is most of the download; fetch it while the backend starts.
    const download = strong ? downloadStrongModel() : fetchBytes("/models/katago-small.bin.gz");
    download.catch(() => {}); // Reported below, after the backend.
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
    const parsed = parseKataGoModelV8(ungzip(await download));
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
      engine: "katago", backend, model: modelName,
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
/** Policy for the next move; the settle playout (決着手順) asks the same way. */
async function evaluateMovePolicy(state: unknown, settle = false) {
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
    const [raw, pass, rawOwnership, values, scores] = await Promise.all([
      output.policy.data(), output.policyPass.data(), output.ownership.data(),
      output.value.data(), output.scoreValue.data()
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
    const evaled = postprocessKataGoV8({
      nextPlayer: pos.currentPlayer, valueLogits: values, scoreValue: scores,
      postProcessParams: model.postProcessParams, modelVersion: model.modelVersion
    });
    return { kind: settle ? "settle" : "move", engine:"katago", backend, policy, passLogit:pass[0], ownership,
      winRate: evaled.blackWinProb, lead: evaled.blackScoreLead };
  } finally {
    spatial.dispose(); global.dispose();
    if (output) for (const t of Object.values(output)) t.dispose();
  }
}
/**
 * 最強's read when it is behind: play the network's favourite legal moves,
 * evaluate the position after each, and keep the move that leaves the side
 * to move the best score lead. Two moves deep, each move is judged by the
 * opponent's best of its favourite answers. A newer request stops the read.
 * Score rather than win rate: on 9x9 with komi 7.5 the network already gives
 * Black about 6% at the start, half a point behind, so win rates near 0 or 1
 * say little about which move holds up best.
 */
const READ_WIDTH = { 1: 8, 2: 5 } as const;
const REPLY_WIDTH = 3;
type ReadState = { next: number; board: number[] };
function favourites(state: ReadState, policy: number[], count: number) {
  const moves: { position: number; child: ReadState }[] = [];
  for (const { p } of policy.map((logit, p) => ({ p, logit })).sort((a, b) => b.logit - a.logit)) {
    if (moves.length >= count) break;
    if (state.board[p]) continue;
    try { moves.push({ position: p, child: play(state, p) }); } catch {}
  }
  return moves;
}
// How long one evaluation takes on this device, for the page's time estimate.
let evalMs = 0;
async function timedEvaluation(state: ReadState) {
  const start = performance.now();
  const result = await evaluateMovePolicy(state);
  const took = performance.now() - start;
  evalMs = evalMs ? evalMs * 0.7 + took * 0.3 : took;
  return result;
}
/** Tells the page how far the read is, after each evaluation. */
type ReadStep = (done: number, total: number) => void;
async function readAhead(state: ReadState, policy: number[], depth: 1 | 2, step: ReadStep) {
  const moverLead = (black: number) => state.next === BLACK ? black : -black;
  let best: { position: number; lead: number } | null = null;
  const moves = favourites(state, policy, READ_WIDTH[depth]);
  // Two deep, each move may have up to REPLY_WIDTH answers to evaluate.
  const total = moves.length * (depth === 2 ? 1 + REPLY_WIDTH : 1);
  let done = 0;
  step(done, total);
  for (const { position, child } of moves) {
    if (newest) return null;
    const answer = await timedEvaluation(child);
    step(++done, total);
    let lead = moverLead(answer.lead);
    if (depth === 2) {
      const replies = favourites(child, answer.policy, REPLY_WIDTH);
      for (const reply of replies) {
        if (newest) return null;
        lead = Math.min(lead, moverLead((await timedEvaluation(reply.child)).lead));
        step(++done, total);
      }
      done += REPLY_WIDTH - replies.length;
    }
    if (!best || lead > best.lead) best = { position, lead };
  }
  return best;
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
        const result: Record<string, unknown> = next.kind === "move" || next.kind === "settle"
          ? await evaluateMovePolicy(next.state, next.kind === "settle") : await evaluate(next.state);
        // 最強 reads only when the side to move is behind, deeper the further behind.
        const state = next.state as ReadState;
        if (strong && next.kind === "move" && next.read) {
          // Points the side to move is behind by.
          const behind = state.next === BLACK ? -(result.lead as number) : result.lead as number;
          const depth = behind >= next.read.two ? 2 : behind >= next.read.one ? 1 : 0;
          if (depth) {
            const read = await readAhead(state, result.policy as number[], depth, (done, total) =>
              self.postMessage({ id: next.id, kind: "reading", depth, done, total, evalMs }));
            if (read) { result.readMove = read.position; result.readDepth = depth; }
          }
        }
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
    kind: event.data.kind === "move" ? "move" : event.data.kind === "settle" ? "settle" :
      event.data.kind === "scoring" ? "scoring" : "analyze",
    read: Number.isFinite(event.data.read?.one) && Number.isFinite(event.data.read?.two)
      ? { one: event.data.read.one, two: event.data.read.two } : undefined };
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
