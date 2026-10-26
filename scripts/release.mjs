#!/usr/bin/env node
// Publish one npm package, @min-agent/min, from the full monorepo build.
// Workspace packages stay private and are not uploaded on their own.
//
//   node scripts/release.mjs check <version>
//   node scripts/release.mjs publish <version> [--dry-run]
//
// check prints the validated version on stdout. Diagnostics go to stderr.
// publish copies CLI, TUI, Web, and package dists into one tarball and
// rewrites @min-agent/* imports to relative files inside that tarball.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const PUBLISH_NAME = "@min-agent/min";
const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const workspaceRoots = ["packages", "apps", "examples", "demos"];
const builtins = new Set(builtinModules);

function fail(message) {
  console.error(message);
  process.exit(1);
}

export function distTag(version) {
  const pre = version.split("+")[0].split("-").slice(1).join("-");
  if (!pre) return "latest";
  if (pre.includes("alpha")) return "alpha";
  if (pre.includes("beta")) return "beta";
  if (/(^|[.-])rc([.-]|$)/.test(pre)) return "rc";
  return "next";
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`${path} is not valid JSON (${error.message})`);
  }
}

function workspacePackages() {
  const found = [];
  for (const root of workspaceRoots) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const dir = join(root, entry);
      const pkgPath = join(dir, "package.json");
      try {
        if (!statSync(dir).isDirectory() || !statSync(pkgPath).isFile()) continue;
      } catch {
        continue;
      }
      found.push({ dir, pkgPath, pkg: readJson(pkgPath) });
    }
  }
  return found;
}

function assertPrivateWorkspace() {
  const problems = [];
  for (const { pkgPath, pkg } of workspacePackages()) {
    if (pkg.private !== true) {
      problems.push(`${pkgPath} is not private (${pkg.name ?? "unnamed"})`);
    }
  }
  if (problems.length > 0) {
    fail(
      `Refusing to publish. Only ${PUBLISH_NAME} is uploaded, and every workspace package must stay private.\n${problems.join("\n")}`,
    );
  }
}

function rootVersion() {
  const root = readJson("package.json");
  if (root.private !== true) fail("the workspace root package.json must stay private");
  if (typeof root.version !== "string" || !semver.test(root.version)) {
    fail(`root package.json version must be strict semver, got ${JSON.stringify(root.version)}`);
  }
  return root.version;
}

function packageNameOf(spec) {
  if (spec.startsWith("@")) {
    const [scope, name] = spec.split("/");
    if (!name) fail(`invalid package specifier ${JSON.stringify(spec)}`);
    return `${scope}/${name}`;
  }
  return spec.split("/")[0];
}

function isBuiltin(spec) {
  if (spec.startsWith("node:")) return true;
  const name = packageNameOf(spec);
  return builtins.has(spec) || builtins.has(name);
}

const importRe =
  /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\(\s*)(["'])([^"']+)\2/g;

function rewriteImports(file, targets) {
  const dir = dirname(file);
  const text = readFileSync(file, "utf8");
  let changed = false;
  const next = text.replace(importRe, (full, prefix, quote, spec) => {
    if (!spec.startsWith("@min-agent/")) return full;
    const name = packageNameOf(spec);
    if (spec !== name) fail(`${file} imports subpath ${spec}. The packed build only exposes each package entry.`);
    const target = targets.get(name);
    if (!target) fail(`${file} imports ${name}, which has no dist entry in the full build`);
    let rel = relative(dir, target).split(sep).join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    changed = true;
    return `${prefix}${quote}${rel}${quote}`;
  });
  if (changed) writeFileSync(file, next);
}

function walkFiles(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(path, acc);
    else acc.push(path);
  }
  return acc;
}

function shouldRewrite(path) {
  if (path.endsWith(".map")) return false;
  if (path.includes(`${sep}web${sep}`)) return false;
  return path.endsWith(".js") || path.endsWith(".d.ts");
}

function dependencyRange(name, packages) {
  const direct = new Set();
  const dev = new Set();
  for (const { pkg } of packages) {
    const spec = pkg.dependencies?.[name];
    const devSpec = pkg.devDependencies?.[name];
    if (typeof spec === "string") direct.add(spec);
    if (typeof devSpec === "string") dev.add(devSpec);
  }
  const source = direct.size > 0 ? direct : dev;
  if (source.size === 0) fail(`built output imports ${name}, but no workspace package.json declares it`);
  if (source.size > 1) fail(`conflicting ranges for ${name}: ${[...source].join(", ")}`);
  const range = [...source][0];
  if (range.startsWith("workspace:")) fail(`${name} is still a workspace dependency in the packed output`);
  return range;
}

function externalDependencies(stageDir, packages) {
  const names = new Set();
  for (const file of walkFiles(stageDir)) {
    if (!shouldRewrite(file) || !file.endsWith(".js")) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(importRe)) {
      const spec = match[3];
      if (spec.startsWith(".") || spec.startsWith("/") || isBuiltin(spec)) continue;
      if (spec.startsWith("@min-agent/")) {
        fail(`${file} still imports ${spec} after packing`);
      }
      names.add(packageNameOf(spec));
    }
  }
  const dependencies = {};
  for (const name of [...names].sort()) dependencies[name] = dependencyRange(name, packages);
  return dependencies;
}

function copyBuild(stageDir) {
  const targets = new Map();
  for (const { dir, pkg } of workspacePackages()) {
    if (typeof pkg.name !== "string" || !pkg.name.startsWith("@min-agent/")) continue;
    if (!dir.startsWith("packages/")) continue;
    const dist = join(dir, "dist");
    try {
      if (!statSync(dist).isDirectory()) fail(`${pkg.name} has no dist. Run pnpm build first.`);
    } catch {
      fail(`${pkg.name} has no dist. Run pnpm build first.`);
    }
    const short = pkg.name.slice("@min-agent/".length);
    const dest = join(stageDir, "dist", "pkg", short);
    cpSync(dist, dest, { recursive: true, dereference: true });
    const entry = join(dest, "index.js");
    try {
      if (!statSync(entry).isFile()) fail(`${pkg.name} dist has no index.js`);
    } catch {
      fail(`${pkg.name} dist has no index.js`);
    }
    targets.set(pkg.name, entry);
  }

  const apps = [
    ["apps/cli/dist", "dist"],
    ["apps/tui/dist", "dist"],
    ["apps/webui/dist", "dist/webui"],
  ];
  for (const [from, to] of apps) {
    try {
      if (!statSync(from).isDirectory()) fail(`${from} is missing. Run pnpm build first.`);
    } catch {
      fail(`${from} is missing. Run pnpm build first.`);
    }
    cpSync(from, join(stageDir, to), { recursive: true, dereference: true });
  }

  for (const file of walkFiles(join(stageDir, "dist"))) {
    if (shouldRewrite(file)) rewriteImports(file, targets);
  }
  return targets;
}

function stage(version) {
  const packages = workspacePackages();
  const stageDir = join(tmpdir(), `min-release-${version.replace(/[^0-9A-Za-z.-]/g, "_")}-${process.pid}`);
  rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  copyBuild(stageDir);
  const dependencies = externalDependencies(stageDir, packages);
  const manifest = {
    name: PUBLISH_NAME,
    version,
    description: "min — CLI, TUI, and Web UI for the agent harness. One package, built from the whole repo.",
    license: "MIT",
    type: "module",
    bin: {
      min: "dist/cli.js",
      "min-tui": "dist/tui.js",
      "min-web": "dist/webui/server.js",
    },
    files: ["dist"],
    dependencies,
    engines: { node: ">=20" },
    publishConfig: { access: "public" },
  };
  writeFileSync(join(stageDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  cpSync("LICENSE", join(stageDir, "LICENSE"));
  writeFileSync(
    join(stageDir, "README.md"),
    `# ${PUBLISH_NAME}\n\nThe full min build: \`min\`, \`min-tui\`, and \`min-web\`.\n\nWorkspace modules are packed inside this tarball. They are not published as separate npm packages.\n\n\`\`\`bash\nnpm install -g ${PUBLISH_NAME}@${distTag(version)}\nmin --help\n\`\`\`\n`,
  );
  console.error(`staged ${stageDir}`);
  console.error(`dependencies ${Object.keys(dependencies).join(", ")}`);
  return { stageDir, manifest };
}

function registryVersion(name, version) {
  try {
    const out = execFileSync("npm", ["view", `${name}@${version}`, "version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim();
  } catch (error) {
    const text = `${error.stderr ?? ""}\n${error.stdout ?? ""}`;
    if (text.includes("E404") || text.includes("404")) return null;
    fail(`could not read ${name}@${version} from the registry\n${text.trim()}`);
  }
}

function publishStaged(stageDir, version, tag, dryRun) {
  const published = registryVersion(PUBLISH_NAME, version);
  if (published === version) {
    console.error(`skip ${PUBLISH_NAME}@${version} (already on npm)`);
    return;
  }
  const args = ["publish", stageDir, "--access", "public", "--tag", tag, "--ignore-scripts"];
  if (dryRun) args.push("--dry-run");
  console.error(`${dryRun ? "dry-run" : "publish"} ${PUBLISH_NAME}@${version} --tag ${tag}`);
  execFileSync("npm", args, { stdio: "inherit" });
}

function main() {
  const [command, versionArg, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes("--dry-run");
  const unknown = rest.filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) fail(`unknown argument ${unknown.join(" ")}`);
  if (command !== "check" && command !== "publish") {
    fail("usage: node scripts/release.mjs <check|publish> <version> [--dry-run]");
  }
  if (!versionArg) fail("No release version. Push a tag v<version>, or pass the version explicitly.");
  if (!semver.test(versionArg)) {
    fail(`Release version must be strict semver without a leading v, got ${JSON.stringify(versionArg)}.`);
  }

  assertPrivateWorkspace();
  const version = rootVersion();
  if (version !== versionArg) fail(`root package.json is ${version}, expected ${versionArg}`);

  if (command === "check") {
    console.error(`ok ${PUBLISH_NAME}@${version} --tag ${distTag(version)}`);
    process.stdout.write(`${version}\n`);
    return;
  }

  const { stageDir } = stage(version);
  publishStaged(stageDir, version, distTag(version), dryRun);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
