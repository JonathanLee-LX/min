import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "node20",
  external: ["@min-agent/core", "@min-agent/providers", "@min-agent/session", "@min-agent/skills", "@min-agent/tools"],
});
