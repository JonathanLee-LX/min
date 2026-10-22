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
  external: ["@min/core", "@min/skills", "@min/tools", "zod"],
});
