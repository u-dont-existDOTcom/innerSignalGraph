import fs from "node:fs/promises";
import path from "node:path";

export async function writeRoadmapState(stateDir, details = {}) {
  const body = {
    schemaVersion: 2,
    updatedAt: new Date().toISOString(),
    policy: {
      advanceWithoutAsking: true,
      routineLogsAreInternal: true,
      stopOnlyForIrreducibleHumanAction: true
    },
    completedMilestones: [
      "M001-adversarial-headless-kernel",
      "M002-runnable-local-web-mvp",
      "M003-use-and-evidence-collection",
      "M004-inner-child-somatic-guide-graph"
    ],
    currentMode: "guide-graph-informed-foreground-local-app",
    nextAutomaticBehavior: "On the next run, recompile the guide graph, rerun deterministic branch cases, revalidate compatible checkpoints, and launch the app. Routine evidence remains local.",
    futureQueue: [
      "benchmark Sonnet 4.6 as a low-ambiguity graph-contract renderer",
      "compile meditation and loving-kindness guides",
      "compile altered-state support as a state machine",
      "component-scoped hypnosis regeneration",
      "encrypted local storage before production release",
      "accessible audio interruption recovery",
      "release browser matrix"
    ],
    ...details
  };
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(path.join(stateDir, "product-roadmap-state.json"), `${JSON.stringify(body, null, 2)}\n`);
  return body;
}
