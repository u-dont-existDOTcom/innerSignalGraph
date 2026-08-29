import fs from "node:fs/promises";
import path from "node:path";
import { projectRoot } from "../core/config.mjs";
import { loadCompiledGuideGraphBundle } from "./compiler.mjs";
import { planFromGraphs } from "./planner.mjs";

function includesAll(actual, expected = []) {
  return expected.every((item) => actual.includes(item));
}

function excludesAll(actual, expected = []) {
  return expected.every((item) => !actual.includes(item));
}

function includesPatterns(actual, expected = []) {
  const text = (actual ?? []).join("\n").toLowerCase();
  return expected.every((pattern) => text.includes(String(pattern).toLowerCase()));
}

export async function runGraphRegressionSuite({ root = projectRoot, bundle = null, cases = null } = {}) {
  const corpusDir = path.join(root, "corpus", "graph-cases");
  let definitions = cases === null ? null : structuredClone(cases);
  if (definitions === null) {
    const files = (await fs.readdir(corpusDir)).filter((file) => file.endsWith(".json")).sort();
    definitions = await Promise.all(files.map(async (file) => JSON.parse(await fs.readFile(path.join(corpusDir, file), "utf8"))));
  }
  if (!Array.isArray(definitions)) throw new TypeError("Graph regression cases must be an array.");
  const selectedBundle = bundle === null ? await loadCompiledGuideGraphBundle({ root }) : structuredClone(bundle);
  const results = [];
  for (const definition of definitions) {
    const plan = planFromGraphs({ variables: definition.variables, unknowns: definition.unknowns, graphs: selectedBundle.graphs });
    const selected = plan.selectedNodes.map((node) => node.id);
    const matched = plan.trace.filter((item) => item.matched).map((item) => item.id);
    const deferred = plan.deferredNodes.map((node) => node.id);
    const blocked = plan.blockedNodes.map((node) => node.id);
    const checks = {
      primary: !definition.expected.primary || plan.primaryJob?.id === definition.expected.primary,
      selectedIncludes: includesAll(selected, definition.expected.selectedIncludes),
      selectedExcludes: excludesAll(selected, definition.expected.selectedExcludes),
      matchedIncludes: includesAll(matched, definition.expected.matchedIncludes),
      deferredIncludes: includesAll(deferred, definition.expected.deferredIncludes),
      blockedIncludes: includesAll(blocked, definition.expected.blockedIncludes),
      nextQuestion: !definition.expected.nextQuestion || plan.nextQuestion === definition.expected.nextQuestion,
      requiredNuancePatterns: includesPatterns(plan.requiredNuance, definition.expected.requiredNuancePatterns),
      forbiddenOverclaimPatterns: includesPatterns(plan.forbiddenOverclaims, definition.expected.forbiddenOverclaimPatterns)
    };
    results.push({ id: definition.id, ok: Object.values(checks).every(Boolean), checks, primary: plan.primaryJob?.id ?? null, selected, matched, deferred, blocked });
  }
  return { ok: results.every((result) => result.ok), count: results.length, results };
}
