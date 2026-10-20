// Workers Builds can restore a cached copy of public/ from another branch's build
// over the fresh checkout. On Workers Builds only, put the tracked files in public/ back.
import { execFileSync } from "node:child_process";

if (process.env.WORKERS_CI === "1") {
  const changed = execFileSync("git", ["diff", "--name-only", "--", "public"], { encoding: "utf8" }).split("\n").filter(Boolean);
  if (changed.length) {
    execFileSync("git", ["checkout", "--", "public"]);
    console.log("Restored " + changed.length + " tracked files the build cache had replaced: " + changed.slice(0, 10).join(", "));
  }
}
