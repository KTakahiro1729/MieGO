import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
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
  assert.equal(config.vars.TURNSTILE_SITE_KEY, "0x4AAAAAAFa_cYtTAe8aM3OA");
  assert.equal(config.previews.vars.TURNSTILE_SITE_KEY, config.vars.TURNSTILE_SITE_KEY,
    "Worker Previews must use the same configured Turnstile widget");
  assert.equal(JSON.stringify(config).includes("TURNSTILE_SECRET"), false,
    "Turnstile secret must never be committed in Wrangler configuration");
  // Preview environments do not inherit production bindings.
  assert.ok(config.previews, "Workers Preview requires a previews configuration");
  assert.deepEqual(config.previews.durable_objects.bindings, config.durable_objects.bindings,
    "Preview must bind ROOMS to its own isolated GameRoom namespace");
  // Each Preview with a Durable Object class gets its own namespace, and the Free plan allows
  // 100 per account, so branch previews deploy from a copy without GameRoom.
  const preview = JSON.parse(readFileSync(resolve(root, "wrangler.preview.jsonc"), "utf8"));
  const { durable_objects, migrations, previews, vars, ...shared } = config;
  assert.deepEqual({ ...preview, previews: undefined }, { ...shared, previews: undefined });
  assert.deepEqual(preview.previews, { vars: previews.vars });
  for (const p of [config.main, "public/index.html", "public/app.mjs",
      "public/core.mjs", "public/analysis-worker.mjs", "public/style.css"]) {
    assert.ok(existsSync(resolve(root, p)), "Missing required file: " + p);
  }
});
test("browser-readable deployment health check exists", () => {
  const src = readFileSync(resolve(root, "src/worker.mjs"), "utf8");
  assert.match(src, /path === "\/api\/health"/);
  assert.match(src, /durableObjectBinding:/);
  assert.match(src, /katagoWorkerReady/);
  assert.match(src, /katagoModelReady/);
  assert.match(src, /turnstileConfigured:/);
  assert.match(src, /Human verification failed/);
});
test("index.html preloads every module app.mjs imports, so they load in parallel", async () => {
  const { moduleGraph, renderIndex } = await import("../scripts/build-html.mjs");
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const [graph, html] = [await moduleGraph(), await renderIndex()];
    assert.ok(graph.includes("core.mjs") && graph.includes("gif-encoder.mjs"));
    for (const name of graph.slice(1)) assert.match(html, new RegExp('<link rel="modulepreload" href="/' + name.replace(".", "\\.") + '">'));
    assert.doesNotMatch(html, /module preloads -->/);
  } finally { process.chdir(cwd); }
});
test("search engines and link previews get a description, one canonical URL and the images it names", async () => {
  const { renderIndex } = await import("../scripts/build-html.mjs");
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const html = await renderIndex();
    assert.match(html, /<meta name="description" content="[^"{]{40,}">/);
    assert.match(html, /<link rel="canonical" href="https:\/\/miego\.fun\/">/);
    assert.match(html, /<h1 class="brand"/);
    for (const [, path] of html.matchAll(/(?:href|content)="(?:https:\/\/miego\.fun)?(\/[\w-]+\.(?:png|ico))"/g))
      assert.ok(existsSync(resolve(root, "public" + path)), "Missing image: " + path);
    assert.match(html, /og:image" content="https:\/\/miego\.fun\/og-image\.png"/);
  } finally { process.chdir(cwd); }
  assert.match(readFileSync(resolve(root, "public/robots.txt"), "utf8"), /^Sitemap: https:\/\/miego\.fun\/sitemap\.xml$/m);
  assert.match(readFileSync(resolve(root, "public/sitemap.xml"), "utf8"), /<loc>https:\/\/miego\.fun\/<\/loc>/);
});
test("the page may not be framed, and its policy admits every third party the page loads", () => {
  const headers = readFileSync(resolve(root, "public/_headers"), "utf8");
  assert.match(headers, /^  X-Frame-Options: DENY$/m);
  const csp = headers.match(/^  Content-Security-Policy: (.+)$/m)?.[1];
  assert.ok(csp, "Missing Content-Security-Policy");
  const directives = Object.fromEntries(csp.split(";").map(d => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));
  assert.deepEqual(directives["frame-ancestors"], ["'none'"]);
  assert.deepEqual(directives["object-src"], ["'none'"]);
  assert.ok(!directives["script-src"].includes("'unsafe-inline'") && !directives["script-src"].includes("'unsafe-eval'"));
  // Turnstile's script and widget, the share image's fonts, and the KataGo WASM.
  const origin = (file, pattern) => new URL(readFileSync(resolve(root, file), "utf8").match(pattern)[1]).origin;
  const turnstile = origin("public/p2p-verify.mjs", /TURNSTILE_SCRIPT = "([^"]+)"/);
  assert.ok(directives["script-src"].includes(turnstile) && directives["frame-src"].includes(turnstile));
  assert.ok(directives["style-src"].includes(origin("public/share-image.mjs", /href:"([^"]+)"/)));
  assert.ok(directives["script-src"].includes("'wasm-unsafe-eval'"));
});
test("the KataGo worker's build is kept by browsers, and only under a content-hashed path", () => {
  const headers = readFileSync(resolve(root, "public/_headers"), "utf8");
  assert.match(headers, /^\/katago\/\*\n  Cache-Control: public, max-age=31536000, immutable$/m);
  // The entry the page loads stays outside /katago/, so a new build is found on the next visit.
  const entry = readFileSync(resolve(root, "public/katago-worker.bundle.mjs"), "utf8");
  const path = entry.match(/^import "\/(katago\/[0-9a-f]{16})\/worker\.mjs";$/m)?.[1];
  assert.ok(path, "The worker entry must import a hashed build");
  for (const file of ["worker.mjs", "tfjs-backend-wasm.wasm", "tfjs-backend-wasm-simd.wasm"])
    assert.ok(existsSync(resolve(root, "public", path, file)), "Missing " + path + "/" + file);
});
test("Workers Builds puts back public/ files its build cache replaced before anything is built", () => {
  const { scripts } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  for (const name of ["pretest", "predeploy"]) assert.match(scripts[name], /^node scripts\/restore-sources\.mjs && /);
});
test("Workers Builds removes untracked public/ files a cached build added, and keeps ignored ones", () => {
  const dir = mkdtempSync(resolve(tmpdir(), "restore-sources-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
    mkdirSync(resolve(dir, "scripts"));
    mkdirSync(resolve(dir, "public/katago"), { recursive: true });
    copyFileSync(resolve(root, "scripts/restore-sources.mjs"), resolve(dir, "scripts/restore-sources.mjs"));
    writeFileSync(resolve(dir, ".gitignore"), "public/katago/\npublic/index.html\n");
    writeFileSync(resolve(dir, "public/app.mjs"), "tracked\n");
    git("init", "-q");
    git("add", ".");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    // What another branch's cached build leaves behind.
    writeFileSync(resolve(dir, "public/app.mjs"), "replaced\n");
    mkdirSync(resolve(dir, "public/extra"));
    writeFileSync(resolve(dir, "public/extra/page.mjs"), "added\n");
    writeFileSync(resolve(dir, "public/other-branch.mjs"), "added\n");
    writeFileSync(resolve(dir, "public/katago/model.bin"), "cached\n");
    writeFileSync(resolve(dir, "public/index.html"), "generated\n");
    const log = execFileSync(process.execPath, ["scripts/restore-sources.mjs"],
      { cwd: dir, encoding: "utf8", env: { ...process.env, WORKERS_CI: "1" } });
    assert.equal(readFileSync(resolve(dir, "public/app.mjs"), "utf8"), "tracked\n");
    assert.equal(existsSync(resolve(dir, "public/other-branch.mjs")), false);
    assert.equal(existsSync(resolve(dir, "public/extra")), false);
    assert.ok(existsSync(resolve(dir, "public/katago/model.bin")), "Ignored KataGo files must stay cached");
    assert.ok(existsSync(resolve(dir, "public/index.html")));
    assert.match(log, /Removed 2 untracked files the build cache had added: .*public\/other-branch\.mjs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("production, built from the release branch, leaves 棋風診断 and new 対友人 games out", async () => {
  const { releaseBuild, renderAiGuide, renderIndex } = await import("../scripts/build-html.mjs");
  assert.equal(releaseBuild({ WORKERS_CI_BRANCH: "release" }), true);
  assert.equal(releaseBuild({ WORKERS_CI_BRANCH: "main" }), false);
  assert.equal(releaseBuild({}), false);
  const cwd = process.cwd();
  process.chdir(root);
  try {
    assert.match(await renderIndex(true), /<html lang="ja" data-no-p2p data-no-play-style>/);
    assert.doesNotMatch(await renderIndex(false), /data-no-(p2p|play-style)/);
    // The guide for AIs at /ai.md follows: production's leaves 友人対局 and 棋風診断 out.
    const [release, preview] = [await renderAiGuide(true), await renderAiGuide(false)];
    assert.doesNotMatch(release, /友人|招待|room|棋風/);
    assert.match(preview, /友人対局/);
    assert.match(preview, /`\?room=`は友人との対戦招待専用/);
    for (const guide of [release, preview]) {
      assert.doesNotMatch(guide, /<!--/);
      assert.match(guide, /他の進行中の対局/);
    }
  } finally { process.chdir(cwd); }
  const css = readFileSync(resolve(root, "public/style.css"), "utf8");
  for (const id of ["scoreStyle", "sharePlayStyles", "historyStyle", "historyStyleBar"])
    assert.match(css, new RegExp("\\[data-no-play-style\\] :is\\([^)]*#" + id + "\\b"));
  const app = readFileSync(resolve(root, "public/app.mjs"), "utf8");
  assert.match(app, /const noNewFriendGames=document\.documentElement\.hasAttribute\("data-no-p2p"\);/);
  assert.match(app, /value="online"\]'\)\.closest\("label"\)\.hidden=true;\n  \$\("help-online"\)\.hidden=true;/);
  // Shared /style links open the app instead of a missing page.
  assert.match(readFileSync(resolve(root, "src/worker.mjs"), "utf8"),
    /path === "\/style" && asset\.status === 404\) return Response\.redirect\(new URL\("\/", url\.origin\), 302\)/);
});
test("only main's Preview has the 対友人 rooms", async () => {
  const { previewConfig } = await import("../scripts/deploy-preview.mjs");
  assert.equal(previewConfig({ WORKERS_CI_BRANCH: "main" }), "wrangler.jsonc");
  for (const branch of ["feature/play-style", "claude/project-thread-g1zcr0", undefined])
    assert.equal(previewConfig({ WORKERS_CI_BRANCH: branch }), "wrangler.preview.jsonc");
});
