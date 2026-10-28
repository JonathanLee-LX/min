import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "mind-main": "src/mind-main.ts",
    "client-main": "src/client-main.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  target: "node20",
  external: ["@min-agent/client", "@min-agent/runtime", "@min-agent/session"],
});
