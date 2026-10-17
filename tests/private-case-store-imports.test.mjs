import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The case store runs in the local server, which starts from a copy of the repository without node_modules
// (tests/runtime-service-liveness.test.mjs). So the store, with everything it imports, reaches no npm package: only
// node: built-ins and the repository's own modules. Change B's known-versus-new check once reached ajv through the journal
// graph; word splitting now comes from src/journal-import/lexical.mjs, which imports nothing.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Static imports and re-exports, side-effect imports, and dynamic imports of a literal specifier.
const IMPORTS = [
  /^[ \t]*(?:import|export)\b[^;"'`]*?\bfrom[ \t]*["']([^"'\n]+)["']/gmu,
  /^[ \t]*import[ \t]*["']([^"'\n]+)["']/gmu,
  /\bimport\(\s*["']([^"'\n]+)["']\s*\)/gu
];

// Every module a file reaches, and each package specifier with the chain of files that reaches it.
function importGraph(start) {
  const reached = new Set();
  const packages = [];
  const queue = [[path.join(root, start), [start]]];
  while (queue.length) {
    const [file, chain] = queue.shift();
    if (reached.has(file)) continue;
    reached.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const pattern of IMPORTS) {
      for (const [, specifier] of source.matchAll(pattern)) {
        if (specifier.startsWith(".")) {
          const target = path.resolve(path.dirname(file), specifier);
          queue.push([target, [...chain, path.relative(root, target)]]);
        } else if (!(specifier.startsWith("node:") && isBuiltin(specifier))) {
          packages.push(`${specifier} <- ${chain.join(" <- ")}`);
        }
      }
    }
  }
  return { reached, packages };
}

test("the case store and everything it imports reach no package outside the node: built-ins", () => {
  const { reached, packages } = importGraph("src/storage/private-case-store.mjs");
  assert.deepEqual(packages, []);
  assert.ok(reached.has(path.join(root, "src/case-formulation/known-vs-new.mjs")), "the walk follows the store's imports");
  assert.ok(reached.has(path.join(root, "src/journal-import/lexical.mjs")));
  // The walk does find a package where one is imported: the journal graph's contracts use ajv.
  assert.ok(importGraph("src/journal-import/graph.mjs").packages.some((entry) => entry.startsWith("ajv")));
});
