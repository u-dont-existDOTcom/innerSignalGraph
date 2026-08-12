import { runGraphRegressionSuite } from "../guide-graph/regressions.mjs";
const result = await runGraphRegressionSuite();
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
