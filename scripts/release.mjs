#!/usr/bin/env node
// Check and publish the public @min-agent packages.
//
//   node scripts/release.mjs check <version>
//   node scripts/release.mjs publish <version> [--dry-run]
//
// check prints the validated version on stdout. Diagnostics go to stderr.
// publish uploads packages/ and apps/ that are not private. A version already
// on the registry is skipped, so a failed release can be re-run.

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const roots = ["packages", "apps"];

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

function readPackage(dir) {
  const pkgPath = join(dir, "package.json");
  let raw;
  try {
    raw = readFileSync(pkgPath, "utf8");
  } catch {
    return null;
  }
  try {
    return { dir, pkgPath, pkg: JSON.parse(raw) };
  } catch {
    fail(`${pkgPath} is not valid JSON`);
  }
}

function collectPublishable() {
  const found = [];
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      fail(`missing directory ${root}`);
    }
    for (const entry of entries) {
      const dir = join(root, entry);
      try {
        if (!statSync(dir).isDirectory()) continue;
      } catch {
        continue;
      }
      const loaded = readPackage(dir);
      if (!loaded) continue;
      const { pkg, pkgPath } = loaded;
      if (pkg.private === true) continue;
      if (typeof pkg.name !== "string" || !pkg.name.startsWith("@min-agent/")) {
        fail(`${pkgPath} is publishable but its name is ${JSON.stringify(pkg.name)}`);
      }
      if (typeof pkg.version !== "string" || !semver.test(pkg.version)) {
        fail(`${pkg.name} has a non-semver version ${JSON.stringify(pkg.version)}`);
      }
      found.push({ name: pkg.name, version: pkg.version, dir, pkg });
    }
  }
  if (found.length === 0) {
    fail("no publishable @min-agent packages found under packages/ and apps/");
  }
  return order(found);
}

function workspaceDeps(pkg) {
  const specs = {
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
    ...pkg.peerDependencies,
  };
  return Object.entries(specs)
    .filter(([, spec]) => typeof spec === "string" && spec.startsWith("workspace:"))
    .map(([name]) => name);
}

function order(pkgs) {
  const byName = new Map(pkgs.map((pkg) => [pkg.name, pkg]));
  const visiting = new Set();
  const visited = new Set();
  const out = [];
  function visit(pkg) {
    if (visited.has(pkg.name)) return;
    if (visiting.has(pkg.name)) fail(`dependency cycle includes ${pkg.name}`);
    visiting.add(pkg.name);
    for (const name of workspaceDeps(pkg.pkg)) {
      const dep = byName.get(name);
      if (dep) visit(dep);
    }
    visiting.delete(pkg.name);
    visited.add(pkg.name);
    out.push(pkg);
  }
  for (const pkg of pkgs) visit(pkg);
  return out;
}

function assertUnified(pkgs, expected) {
  const problems = [];
  for (const pkg of pkgs) {
    if (pkg.version !== expected) {
      problems.push(`${pkg.name} is ${pkg.version}, expected ${expected}`);
    }
  }
  if (problems.length > 0) {
    fail(problems.join("\n"));
  }
}

function registryVersion(name, version) {
  try {
    const out = execFileSync(
      "npm",
      ["view", `${name}@${version}`, "version"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return out.trim();
  } catch (error) {
    const stderr = `${error.stderr ?? ""}`;
    const stdout = `${error.stdout ?? ""}`;
    const text = `${stderr}\n${stdout}`;
    if (text.includes("E404") || text.includes("404")) return null;
    fail(`could not read ${name}@${version} from the registry\n${text.trim()}`);
  }
}

function publishOne(pkg, tag, dryRun) {
  const published = registryVersion(pkg.name, pkg.version);
  if (published === pkg.version) {
    console.error(`skip ${pkg.name}@${pkg.version} (already on npm)`);
    return;
  }
  const args = [
    "--filter",
    pkg.name,
    "publish",
    "--access",
    "public",
    "--tag",
    tag,
    "--no-git-checks",
  ];
  if (dryRun) args.push("--dry-run");
  console.error(`${dryRun ? "dry-run" : "publish"} ${pkg.name}@${pkg.version} --tag ${tag}`);
  execFileSync("pnpm", args, { stdio: "inherit" });
}

function main() {
  const [command, versionArg, ...rest] = process.argv.slice(2);
  const dryRun = rest.includes("--dry-run");
  const unknown = rest.filter((arg) => arg !== "--dry-run");
  if (unknown.length > 0) fail(`unknown argument ${unknown.join(" ")}`);

  if (command !== "check" && command !== "publish") {
    fail("usage: node scripts/release.mjs <check|publish> <version> [--dry-run]");
  }
  if (!versionArg) {
    fail("No release version. Push a tag v<version>, or pass the version explicitly.");
  }
  if (!semver.test(versionArg)) {
    fail(
      `Release version must be strict semver without a leading v, got ${JSON.stringify(versionArg)}.`,
    );
  }

  const pkgs = collectPublishable();
  assertUnified(pkgs, versionArg);

  if (command === "check") {
    const tag = distTag(versionArg);
    for (const pkg of pkgs) console.error(`ok ${pkg.name}@${pkg.version} --tag ${tag}`);
    process.stdout.write(`${versionArg}\n`);
  } else {
    const tag = distTag(versionArg);
    console.error(`dist-tag ${tag} for ${pkgs.length} packages`);
    for (const pkg of pkgs) publishOne(pkg, tag, dryRun);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
