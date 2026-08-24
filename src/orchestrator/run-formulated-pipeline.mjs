import { runCaseFormulation } from "../case-formulation/run.mjs";
import { runAdversarialPipeline } from "./run-pipeline.mjs";
import { runTieredTherapyPipeline } from "./run-tiered-pipeline.mjs";
import { classifyInterventionAuthority, normalizeTherapyScaffoldMode } from "./scaffold-authority.mjs";

export async function runFormulatedPipeline({ context, providers, config, caseId = null, onProgress, caseRecovery }) {
  const scaffoldMode = normalizeTherapyScaffoldMode(config.therapyScaffoldMode ?? "current");
  if (scaffoldMode === "model-first") {
    return await runTieredTherapyPipeline({ context, providers, config, processingMode: "forensic", onProgress, caseRecovery });
  }
  const formulation = await runCaseFormulation({ context, providers, onProgress, recovery: caseRecovery });
  const authority = classifyInterventionAuthority({ snapshot: formulation.snapshot, plan: formulation.plan });
  const enrichedContext = {
    ...context,
    caseFormulation: formulation.snapshot,
    interventionContract: formulation.plan,
    graphBundleVersion: formulation.graphBundleVersion,
    ...(scaffoldMode === "current" ? {} : { therapyScaffoldMode: scaffoldMode, interventionAuthority: authority })
  };
  const result = await runAdversarialPipeline({
    context: enrichedContext,
    providers,
    config,
    caseId,
    onProgress
  });
  const response = {
    ...result,
    graphBundleVersion: formulation.graphBundleVersion,
    caseFormulation: formulation.snapshot,
    interventionContract: formulation.plan,
    formulationProviders: formulation.providerMetadata
  };
  if (scaffoldMode !== "current") response.therapyScaffoldMode = scaffoldMode;
  return response;
}
