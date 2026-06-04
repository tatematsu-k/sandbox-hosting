#!/usr/bin/env node
// Bundles each Lambda handler with esbuild into dist/{name}/index.mjs.
// Terraform packages dist/{name}/ as a zip per Lambda function.
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

const targets = [
  { name: "api", entry: "src/handlers/api.ts" },
  { name: "cron", entry: "src/handlers/cron.ts" },
];

await rm(dist, { recursive: true, force: true });

for (const target of targets) {
  const outdir = path.join(dist, target.name);
  await mkdir(outdir, { recursive: true });
  await build({
    entryPoints: [path.join(root, target.entry)],
    outfile: path.join(outdir, "index.mjs"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    sourcemap: "inline",
    minify: true,
    treeShaking: true,
    banner: {
      js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
    },
    external: [
      "@aws-sdk/*",
    ],
  });
  console.log(`built ${target.name} → ${outdir}/index.mjs`);
}
