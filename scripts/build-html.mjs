import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { textAt } from "../public/texts.mjs";

// public/index.html is generated: edit wording in public/texts.mjs and markup
// in src/index.template.html, then run `node scripts/build-html.mjs`.
//   {{help.title}}            a string
//   {{game.moveLabel(0)}}     a function, called with numbers or other keys
//   {{help.basics.items}}     an array, rendered as <li> lines
const TEMPLATE = resolve("src/index.template.html");
const OUTPUT = resolve("public/index.html");
const NOTICE = "<!-- Generated from src/index.template.html and public/texts.mjs. Do not edit. -->\n";

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

export async function renderIndex() {
  const html = renderTemplate(await readFile(TEMPLATE, "utf8"));
  return html.replace("<!doctype html>\n", "<!doctype html>\n" + NOTICE);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await writeFile(OUTPUT, await renderIndex());
  console.log("index.html: rendered from texts.mjs");
}
