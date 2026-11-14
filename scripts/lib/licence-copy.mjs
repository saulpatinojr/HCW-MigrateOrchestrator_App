/**
 * The published packages must carry this repository's own LICENSE, byte for byte: the MIT licence asks for its copyright
 * and permission notice to travel with every copy, so a file that only starts with "MIT License" is not enough.
 * `scripts/verify-packed-consumer.mjs` checks each installed package with this; every caller runs it from a checkout of
 * the commit being released, so the root LICENSE is that commit's. Node standard library only.
 */
import { existsSync, readFileSync } from "node:fs";

/** Throws, naming `label`, unless the file at `copyPath` has exactly the bytes of the file at `rootPath`. */
export function assertLicenceCopy(copyPath, rootPath, label) {
  if (!existsSync(rootPath)) throw new Error(`the repository's LICENSE (${rootPath}) is missing; run this from a checkout of the commit being released`);
  if (!existsSync(copyPath)) throw new Error(`${label} does not carry the MIT licence text: no LICENSE file`);
  if (!readFileSync(copyPath).equals(readFileSync(rootPath))) {
    throw new Error(`${label} LICENSE differs from the repository's root LICENSE (the full MIT licence text must ship unchanged)`);
  }
}
