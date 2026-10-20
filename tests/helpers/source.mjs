import {readFileSync} from "node:fs";

// Source-reading tests share one copy of each file. A name is read from
// public/; "../src/…" and other relative paths reach the rest of the repo.
const cache=new Map();
export function source(name) {
  if(!cache.has(name))cache.set(name,readFileSync(new URL("../../public/"+name,import.meta.url),"utf8"));
  return cache.get(name);
}
export const html=source("index.html");
export const app=source("app.mjs");
export const css=source("style.css");

// The part of the page from the first `from` up to the next `to` after it.
export function between(text,from,to) {
  const start=text.indexOf(from);
  return text.slice(start,text.indexOf(to,start));
}
