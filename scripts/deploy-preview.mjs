// The Preview deploy command on Workers Builds. main's Preview gets the 対友人
// rooms from wrangler.jsonc, so friend games can be tried before a release; every
// other branch deploys from wrangler.preview.jsonc without them, since each Preview
// with a Durable Object takes one of the account's 100 namespaces.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const previewConfig = (env = process.env) =>
  env.WORKERS_CI_BRANCH === "main" ? "wrangler.jsonc" : "wrangler.preview.jsonc";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = previewConfig();
  console.log("Preview from " + config);
  execFileSync("npx", ["wrangler", "preview", "-c", config], { stdio: "inherit" });
}
