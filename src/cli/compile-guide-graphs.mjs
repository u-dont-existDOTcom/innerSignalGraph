import { compileGuideGraphs } from "../guide-graph/compiler.mjs";

const bundle = await compileGuideGraphs();
console.log(JSON.stringify({
  ok: true,
  contractVersion: bundle.contractVersion,
  version: bundle.version,
  stats: bundle.stats,
  report: "guide-graphs/reports/inner-child-somatic-pilot.md"
}, null, 2));
