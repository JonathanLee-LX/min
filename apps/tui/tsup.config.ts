import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/tui.tsx"],
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
  esbuildOptions(options) {
    options.jsx = "automatic";
  },
  external: [
    "@min-agent/client",
    "@min-agent/config",
    "@min-agent/mind",
    "@min-agent/runtime",
    "ink",
    "react",
  ],
});
