import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("Workers deployment configuration and static assets are present", () => {
  const config = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));
  assert.equal(config.name, "miego");
  assert.equal(config.assets.binding, "ASSETS");
  assert.deepEqual(config.assets.run_worker_first, ["/api/*"]);
  assert.equal(config.durable_objects.bindings[0].class_name, "GameRoom");
  assert.ok(config.migrations[0].new_sqlite_classes.includes("GameRoom"));
  for (const p of [config.main, "public/index.html", "public/app.mjs",
      "public/core.mjs", "public/analysis-worker.mjs", "public/style.css"]) {
    assert.ok(existsSync(resolve(root, p)), "Missing required file: " + p);
  }
});
test("browser-readable deployment health check exists", () => {
  const src = readFileSync(resolve(root, "src/worker.mjs"), "utf8");
  assert.match(src, /url\.pathname === "\/api\/health"/);
  assert.match(src, /durableObjectBinding:/);
  assert.match(src, /katagoWorkerReady/);
  assert.match(src, /katagoModelReady/);
});
