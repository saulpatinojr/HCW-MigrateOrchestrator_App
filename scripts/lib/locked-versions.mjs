/**
 * The exact versions this repository's own tests ran against, read from package-lock.json, for the packages a consumer must
 * supply itself (the React peers and their types). The release tooling installs these instead of a floating range such as
 * `react@^19`, so the clean-consumer gate and the attested SBOM describe the same tree on every run of the same commit
 * (review of pull request 79). Node standard library only.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The exact version of `name` in the root lockfile; throws when it is missing or not an exact version. */
export function lockedVersion(name, root = ROOT) {
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
  const version = lock.packages?.[`node_modules/${name}`]?.version;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`package-lock.json has no exact version for ${name} (got ${JSON.stringify(version)}); the release tooling will not install a floating range`);
  }
  return version;
}

/** `name@exact` arguments for `npm install`. */
export const lockedSpecs = (names, root = ROOT) => names.map((n) => `${n}@${lockedVersion(n, root)}`);

export const CONSUMER_PEERS = ["react", "react-dom"];
export const CONSUMER_TYPES = ["@types/react", "@types/react-dom"];
