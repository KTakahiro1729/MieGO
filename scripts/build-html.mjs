import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { textAt } from "../public/texts.mjs";

// public/index.html is generated: edit wording in public/texts.mjs and markup
// in src/index.template.html, then run `node scripts/build-html.mjs`.
//   {{help.title}}            a string
//   {{game.moveLabel(0)}}     a function, called with numbers or other keys
//   {{help.local.items}}      an array, rendered as <li> lines
const TEMPLATE = resolve("src/index.template.html");
const OUTPUT = resolve("public/index.html");
// The 棋風診断 page at /style, rendered the same way.
const STYLE_TEMPLATE = resolve("src/style.template.html");
const STYLE_OUTPUT = resolve("public/style.html");
const NOTICE = "<!-- Generated from src/index.template.html and public/texts.mjs. Do not edit. -->\n";
// The site serves MieGO's license and the third-party notices as one file,
// since the MIT and Apache licenses ask for them in every copy.
const LICENSES = resolve("public/licenses.txt");

// Production, built from the release branch on Workers Builds, leaves 棋風診断 out
// for now: index.html is marked so the page hides its entries, and /style is not built.
export const hidesPlayStyle = (env = process.env) =>
  env.WORKERS_CI_BRANCH === "release" || env.MIEGO_HIDE_PLAY_STYLE === "1";

function resolveArg(arg) {
  arg = arg.trim();
  return /^-?\d+(\.\d+)?$/.test(arg) ? Number(arg) : textAt(arg);
}

export function renderTemplate(template) {
  return template.replace(/^([ \t]*)?\{\{([\w.]+)(?:\(([^)]*)\))?\}\}|\{\{([\w.]+)(?:\(([^)]*)\))?\}\}/gm,
    (match, indent, lineKey, lineArgs, key, args) => {
      const name = lineKey ?? key, list = lineKey ? lineArgs : args;
      let value = textAt(name);
      if (typeof value === "function") value = value(...(list ? list.split(",").map(resolveArg) : []));
      if (Array.isArray(value)) return value.map(item => (indent ?? "") + "<li>" + item + "</li>").join("\n");
      if (typeof value !== "string") throw Error("Text key is not a string: " + name);
      return (indent ?? "") + value;
    });
}

// Every module app.mjs reaches through static imports, in the order first met.
export async function moduleGraph(entry = "app.mjs") {
  const found = [], queue = [entry];
  while (queue.length) {
    const name = queue.shift();
    if (found.includes(name)) continue;
    found.push(name);
    const source = await readFile(resolve("public", name), "utf8");
    for (const [, path] of source.matchAll(/^\s*(?:import|export)\b[^;"']*?["']\.\/([\w-]+\.mjs)["']/gm)) queue.push(path);
  }
  return found;
}

// Without these the browser finds the modules one import level at a time,
// a round trip per level before the board can be played.
async function modulePreloads(indent) {
  return (await moduleGraph()).slice(1).map(name => indent + '<link rel="modulepreload" href="/' + name + '">').join("\n");
}

export async function renderLicenses() {
  const [own, others] = await Promise.all(["LICENSE", "THIRD_PARTY_NOTICES.md"].map(name => readFile(resolve(name), "utf8")));
  return "# MieGO\n\n" + own.trim() + "\n\n" + others;
}

export async function renderIndex(hidePlayStyle = hidesPlayStyle()) {
  let html = renderTemplate(await readFile(TEMPLATE, "utf8"));
  if (hidePlayStyle) html = html.replace('<html lang="ja">', '<html lang="ja" data-no-play-style>');
  const marker = /^([ \t]*)<!-- module preloads -->$/m;
  if (!marker.test(html)) throw Error("The template lacks the module preloads marker");
  const indent = html.match(marker)[1];
  html = html.replace(marker, await modulePreloads(indent));
  return html.replace("<!doctype html>\n", "<!doctype html>\n" + NOTICE);
}

export async function renderStylePage() {
  const html = renderTemplate(await readFile(STYLE_TEMPLATE, "utf8"));
  return html.replace("<!doctype html>\n", "<!doctype html>\n" + NOTICE.replace("index", "style"));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(OUTPUT, await renderIndex());
  console.log("index.html: rendered from texts.mjs");
  if (hidesPlayStyle()) {
    // A cached public/ from another branch's build may still hold it.
    await rm(STYLE_OUTPUT, { force: true });
    console.log("index.html: 棋風診断 hidden; style.html: left out");
  } else {
    await writeFile(STYLE_OUTPUT, await renderStylePage());
    console.log("style.html: rendered from texts.mjs");
  }
  await writeFile(LICENSES, await renderLicenses());
  console.log("licenses.txt: LICENSE and THIRD_PARTY_NOTICES.md");
}
