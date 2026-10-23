import { defineConfig } from "tsup";

export default defineConfig({
  entry: { server: "src/server/main.ts" },
  format: ["esm"],
  dts: false,
  sourcemap: true,
  clean: false,
  splitting: false,
  treeshake: true,
  target: "node20",
  banner: {
    js: "#!/usr/bin/env node",
  },
  external: ["@min/client", "@min/runtime"],
});
