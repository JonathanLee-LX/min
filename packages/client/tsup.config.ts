import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/process.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "node20",
  external: ["@min-agent/core", "@min-agent/runtime", "@min-agent/session"],
});
