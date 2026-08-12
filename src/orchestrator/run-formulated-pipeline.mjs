import { runCaseFormulation } from "../case-formulation/run.mjs";
import { runAdversarialPipeline } from "./run-pipeline.mjs";

export async function runFormulatedPipeline({ context, providers, config, caseId = null, onProgress, caseRecovery }) {
  const formulation = await runCaseFormulation({ context, providers, onProgress, recovery: caseRecovery });
  const enrichedContext = {
    ...context,
    caseFormulation: formulation.snapshot,
    interventionContract: formulation.plan,
    graphBundleVersion: formulation.graphBundleVersion
  };
  const result = await runAdversarialPipeline({
    context: enrichedContext,
    providers,
    config,
    caseId,
    onProgress
  });
  return {
    ...result,
    graphBundleVersion: formulation.graphBundleVersion,
    caseFormulation: formulation.snapshot,
    interventionContract: formulation.plan,
    formulationProviders: formulation.providerMetadata
  };
}
