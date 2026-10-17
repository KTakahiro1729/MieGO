import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("Cloudflare entrypoints and static assets exist", () => {
  const config = JSON.parse(readFileSync(resolve(root, "wrangler.jsonc"), "utf8"));
  assert.equal(config.assets.binding, "ASSETS");
  assert.deepEqual(config.assets.run_worker_first, ["/api/*"]);
  assert.equal(config.durable_objects.bindings[0].class_name, "GameRoom");
  assert.ok(config.migrations[0].new_sqlite_classes.includes("GameRoom"));
  for (const p of [config.main, "public/index.html", "public/app.mjs",
      "public/core.mjs", "public/analysis-worker.mjs", "public/style.css"]) {
    assert.ok(existsSync(resolve(root, p)), "Missing required file: " + p);
  }
});
