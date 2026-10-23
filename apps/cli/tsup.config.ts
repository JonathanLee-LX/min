import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "node20",
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: [
    "@min/client",
    "@min/runtime",
    "@min/core",
    "@min/session",
    "@min/skills",
    "@min/tools",
    "zod",
  ],
});
